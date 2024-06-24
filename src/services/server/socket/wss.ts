import { Server } from 'ws'
import VirtualAgentInst from '../../../modules/call/api/virtual-agent'

const initWebSocket = (wss: Server) => {
	wss.on('connection', (socket) => {
		VirtualAgentInst(socket)
	})
}

export default initWebSocket
