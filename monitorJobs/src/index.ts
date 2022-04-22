import type { Context, EventFunction } from '@google-cloud/functions-framework'
import { Firestore } from '@google-cloud/firestore'
import { handleAxiosError, CollectionNames, VideoApi, DateHelper } from '@thetabox/services'
import { Db } from '@thetanext/services'
import { JobStatus, FileNetwork, VideoBody, FileStatus } from '@thetabox/model'

const transcodeStatusField = 'transcode_status'

export const monitorJobs: EventFunction = async (data: {}, context: Context) => {
	const firestore = new Firestore() //?
	const db = new Db(firestore) //?
	await monitorTranscodeJobs(db)
	return null
}

async function monitorTranscodeJobs(db: Db) {
	try {
		let queuedTranscodeJobs = await db.listBy<FileNetwork>(CollectionNames.files, transcodeStatusField, JobStatus.Progress) //?

		for (const fileNetwork of queuedTranscodeJobs) {
			const videoApi = new VideoApi(process.env.REACT_APP_VIDEO_API_KEY, process.env.REACT_APP_VIDEO_API_SECRET)
			const videoBody: VideoBody = await videoApi.checkTranscodeProgress(fileNetwork.video?.id)
			videoBody.videos[0].state.toString() === 'success' ? (fileNetwork.transcode_status = JobStatus.Done) : (fileNetwork.transcode_status = JobStatus.Progress)
			const video = videoBody.videos[0]
			fileNetwork.update_time = DateHelper.dayInUnix(new Date())
			fileNetwork.video = video
			fileNetwork.file_status = FileStatus.OnNetwork
		}

		await db.updateAll(CollectionNames.files, queuedTranscodeJobs)
	} catch (error) {
		handleAxiosError(error)
	}
}
