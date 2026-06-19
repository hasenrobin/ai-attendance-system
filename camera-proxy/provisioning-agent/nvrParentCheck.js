import net from 'node:net'
import { NVR_PARENT_CHECK_TIMEOUT_MS, RTSP_DEFAULT_PORT } from './config.js'

// Pure TCP-connect reachability probe for an NVR/DVR parent's management/RTSP
// port. This is the ONLY thing that can make an NVR parent's status
// "Validated" / health "Online" -- parents never get a live_stream_url, so
// there is no HLS check to fall back on. Never throws.
export function checkNvrParentReachable({ host, port }) {
  return new Promise(resolve => {
    const targetPort = port ?? RTSP_DEFAULT_PORT
    const socket = new net.Socket()
    let settled = false

    const finish = (reachable, reason) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ reachable, reason })
    }

    socket.setTimeout(NVR_PARENT_CHECK_TIMEOUT_MS)
    socket.once('connect', () => finish(true, null))
    socket.once('timeout', () => finish(false, `Connection to ${host}:${targetPort} timed out`))
    socket.once('error', err => finish(false, err.message))

    socket.connect(targetPort, host)
  })
}
