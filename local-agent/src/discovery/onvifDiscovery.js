// ============================================================================
// ONVIF WS-Discovery
//
// Sends a UDP multicast WS-Discovery Probe to the ONVIF standard address
// (239.255.255.250:3702) and listens for ProbeMatch responses. Returns IPs
// of ONVIF-capable devices discovered on the LAN.
//
// This is the BROADCAST discovery method — it finds cameras without knowing
// their IP in advance, which is the core value of the Local Agent.
// ============================================================================

import dgram from 'node:dgram'
import { randomUUID } from 'node:crypto'

const WS_DISCOVERY_ADDR = '239.255.255.250'
const WS_DISCOVERY_PORT = 3702
const LISTEN_TIMEOUT_MS = 5000

function buildProbeMessage() {
  const msgId = `uuid:${randomUUID()}`
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <s:Header>
    <a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>
    <a:MessageID>${msgId}</a:MessageID>
    <a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>
  </s:Header>
  <s:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </s:Body>
</s:Envelope>`
}

// Extracts XAddrs (device service URLs) from a ProbeMatch response body.
function extractXAddrs(xml) {
  const matches = [...xml.matchAll(/<[^>]*XAddrs[^>]*>([^<]+)<\/[^>]*XAddrs>/gi)]
  const addrs = []
  for (const m of matches) {
    for (const url of m[1].trim().split(/\s+/)) {
      if (url.startsWith('http')) addrs.push(url)
    }
  }
  return addrs
}

// Extracts IP from a URL or raw address string
function urlToIp(addr) {
  try {
    return new URL(addr).hostname
  } catch {
    return null
  }
}

// Runs WS-Discovery and returns a list of { ip, xaddrs } objects
export function runWsDiscovery() {
  return new Promise(resolve => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const discovered = new Map() // ip → xaddrs[]

    const probe = Buffer.from(buildProbeMessage(), 'utf-8')

    socket.on('error', (err) => {
      console.warn('[onvif-discovery] UDP socket error:', err.message)
      socket.close()
      resolve([...discovered.values()])
    })

    socket.on('message', (msg) => {
      const xml = msg.toString('utf-8')
      if (!xml.includes('ProbeMatch') && !xml.includes('Hello')) return

      const xaddrs = extractXAddrs(xml)
      for (const addr of xaddrs) {
        const ip = urlToIp(addr)
        if (!ip) continue
        if (!discovered.has(ip)) discovered.set(ip, { ip, xaddrs: [] })
        if (!discovered.get(ip).xaddrs.includes(addr)) {
          discovered.get(ip).xaddrs.push(addr)
        }
      }
    })

    socket.bind(0, () => {
      socket.setBroadcast(true)
      try { socket.setMulticastTTL(4) } catch {}
      try { socket.addMembership(WS_DISCOVERY_ADDR) } catch {}

      socket.send(probe, 0, probe.length, WS_DISCOVERY_PORT, WS_DISCOVERY_ADDR, (err) => {
        if (err) console.warn('[onvif-discovery] Send failed:', err.message)
      })

      setTimeout(() => {
        socket.close()
        resolve([...discovered.values()])
      }, LISTEN_TIMEOUT_MS)
    })
  })
}
