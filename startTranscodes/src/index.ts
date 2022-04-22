import type { EventFunction } from '@google-cloud/functions-framework'
import { Firestore } from '@google-cloud/firestore'
import { handleAxiosError, CollectionNames, VideoApi, DateHelper } from '@thetabox/services'
import { Db } from '@thetanext/services'
import { JobStatus, FileNetwork, FileEdgeStore, FileStatus, TranscodeUploadBodyExternal } from '@thetabox/model'
import { Event } from './Event'

export const startTranscodes: EventFunction = async (event: Event, context) => {
	let onAirChange = event.updateMask['fieldPaths'][0] === 'on_air_date' ? true : false //?

	if (!onAirChange) return null
	const firestore = new Firestore()
	const db = new Db(firestore) //?
	await startTranscodeJobs(db)
	return null
}

/**
 * upload files when they are stored and on air date is 1 day before today
 * when uploaded the file status will be Presigned
 */
async function startTranscodeJobs(db: Db) {
	try {
		const uploadDay = DateHelper.yesterday()
		const snapshot = await db
			.collection(CollectionNames.files)
			.where('file_status', '==', FileStatus.Stored)
			.where('on_air_date', '>=', uploadDay)
			.orderBy('on_air_date', 'desc')
			.limit(3)
			.get()
		// todo: remove limit

		if (snapshot.empty) {
			return
		}

		const queuedTranscodeJobs = snapshot.docs.map((x) => ({ ...x.data(), id: x.id })) as FileEdgeStore[]

		const transcodedFiles = await transcodeFiles(queuedTranscodeJobs)
		await db.updateAll(CollectionNames.files, transcodedFiles)
	} catch (error) {
		handleAxiosError(error)
	}
	return
}

export async function transcodeFiles(files: FileEdgeStore[]) {
	const transcodedFiles: FileNetwork[] = []
	for (const file of files) {
		try {
			const videoApi = new VideoApi(process.env.REACT_APP_VIDEO_API_KEY, process.env.REACT_APP_VIDEO_API_SECRET)
			const uploadBody = await videoApi.createPreSignedURL() //?

			const src = `http://${process.env.REACT_APP_IP_EDGE_STORE}:${process.env.REACT_APP_PORT_EDGE_STORE}/api/v1/file?key=${file.edgeStore.key}&relpath=${file.edgeStore.relpath}` //?
			const transcodeUploadBody: TranscodeUploadBodyExternal = { playback_policy: 'public', source_uri: src }
			const videoBody = await videoApi.transcodeExternalVideo(transcodeUploadBody) //?
			console.log(JSON.stringify(videoBody))

			const firstVideo = videoBody.videos[0]
			const fileNetwork: FileNetwork = {
				...file,
				network: uploadBody.uploads[0],
				video: firstVideo,
				transcode_status: JobStatus.Progress,
				update_time: DateHelper.dayInUnix(),
				file_status: FileStatus.OnNetwork,
				restore_status: JobStatus._,
			}
			fileNetwork //?
			transcodedFiles.push(fileNetwork)
		} catch (error) {
			console.error(error)
			file.file_status = FileStatus.Stored
		}
	}
	return transcodedFiles
}
