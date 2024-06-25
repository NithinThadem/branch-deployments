// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as multer from 'multer'
import { Request } from 'express'
import { UserEntity } from '../modules/user/db/user.entity'

export interface FileUploadRequest extends Request {
	files: multer.File & {
		url?: string
		delete?: () => Promise<any>
	}
	file: multer.File & {
		url?: string
		delete?: () => Promise<any>
	}
}

export enum RequestPart {
	BODY = 'body',
	QUERY = 'query',
	PARAMS = 'params',
	FILE = 'file'
}

export type AuthenticatedRequest = Request & {
	auth: {
		iss: string
		sub: string
		aud: string[]
		iat: number
		exp: number
		azp: string
		scope: string
		email: string
		getUser: (relations?: string[]) => Promise<UserEntity>
	}
}
