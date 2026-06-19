// ============================================================================
// TCP Port Scanner
//
// Tests whether a set of ports is open on a given IP using TCP connect.
// Designed for LAN probing — uses short timeouts (300ms) since LAN round-trip
// times are typically <5ms.
// ============================================================================

import { createConnection } from 'node:net'
import { CAMERA_PORTS } from '../config.js'

const PORT_TIMEOUT_MS = 300

// Returns true if the TCP connection to ip:port succeeds within the timeout.
function tryPort(ip, port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: ip, port, timeout: PORT_TIMEOUT_MS })
    let settled = false

    function finish(open) {
      if (settled) return
      settled = true
      try { socket.destroy() } catch {}
      resolve(open)
    }

    socket.once('connect',  () => finish(true))
    socket.once('timeout',  () => finish(false))
    socket.once('error',    () => finish(false))
  })
}

// Scans all CAMERA_PORTS on a single IP concurrently.
// Returns an array of open port numbers.
export async function scanCamera(ip) {
  const results = await Promise.all(CAMERA_PORTS.map(p => tryPort(ip, p)))
  return CAMERA_PORTS.filter((_, i) => results[i])
}

// Processes an array of IPs in batches of `concurrency`.
// Calls onResult(ip, openPorts) for each IP that has at least one open port.
export async function scanSubnet(ips, { concurrency = 30, onResult, signal } = {}) {
  const pending = [...ips]

  async function worker() {
    while (pending.length > 0) {
      if (signal?.aborted) return
      const ip = pending.shift()
      if (!ip) return
      const openPorts = await scanCamera(ip)
      if (openPorts.length > 0) {
        await onResult?.(ip, openPorts)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
}
