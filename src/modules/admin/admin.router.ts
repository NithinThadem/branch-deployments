import { Router } from 'express'
import {
	emitEvent,
	generateTts,
	getAllTeams,
	getElevenLabsModels,
	getElevenLabsVoices,
	getPlayHtVoices,
	getTwilioTrustHubPolicies,
} from './admin.handlers'

export const adminRouter = Router()

adminRouter.post('/generate_tts', generateTts)
adminRouter.get('/eleven_labs_voices', getElevenLabsVoices)
adminRouter.get('/eleven_labs_models', getElevenLabsModels)
adminRouter.get('/playht_voices', getPlayHtVoices)

adminRouter.post('/emit_event', emitEvent)

adminRouter.get('/twilio_policies', getTwilioTrustHubPolicies)

// Admin Routes for Frontend

adminRouter.get('/teams', getAllTeams)

