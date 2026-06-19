// ============================================================================
// Camera Fingerprinting
//
// For each IP with open ports, attempts to identify the manufacturer and model
// by probing HTTP endpoints and inspecting response headers/body.
// Never attempts authentication — only reads public/unauthenticated pages.
// ============================================================================

const HTTP_TIMEOUT_MS = 3000

const MANUFACTURER_SIGNATURES = [
  { name: 'Hikvision', patterns: [/hikvision/i, /\/doc\/page\/login/i, /HIKVISION/] },
  { name: 'Dahua',     patterns: [/dahua/i, /DH_WEB/i, /WebApp\/Login/i] },
  { name: 'Uniview',   patterns: [/uniview/i, /webClient\/login/i, /uniview\.com/i] },
  { name: 'TP-Link',   patterns: [/tp.?link/i, /vigi/i, /tplink/i] },
  { name: 'Grandstream', patterns: [/grandstream/i] },
  { name: 'Axis',      patterns: [/axis communications/i, /axisapp/i] },
  { name: 'Bosch',     patterns: [/bosch security/i] },
  { name: 'Hanwha',    patterns: [/hanwha/i, /samsung techwin/i] },
]

async function httpGet(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
    })
    const body = await res.text().catch(() => '')
    return { ok: true, status: res.status, headers: res.headers, body, url: res.url }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

function detectManufacturer(headers, body) {
  const haystack = [
    headers?.get?.('server') ?? '',
    headers?.get?.('x-powered-by') ?? '',
    body,
  ].join(' ')

  for (const sig of MANUFACTURER_SIGNATURES) {
    if (sig.patterns.some(p => p.test(haystack))) return sig.name
  }
  return null
}

// Build an RTSP URL guess based on manufacturer and port
function guessRtspUrl(ip, manufacturer) {
  const base = `rtsp://${ip}:554`
  switch (manufacturer) {
    case 'Hikvision': return `${base}/Streaming/Channels/101`
    case 'Dahua':     return `${base}/cam/realmonitor?channel=1&subtype=0`
    case 'Uniview':   return `${base}/unicast/c1/s0/live`
    default:          return `${base}/stream`
  }
}

// Probe an IP's open HTTP ports to fingerprint the camera
export async function fingerprintCamera(ip, openPorts) {
  const httpPorts = openPorts.filter(p => [80, 81, 8080].includes(p))
  const rtspOpen  = openPorts.includes(554)

  let manufacturer = null
  let httpUrl = null

  for (const port of httpPorts) {
    const url = `http://${ip}${port === 80 ? '' : `:${port}`}/`
    const result = await httpGet(url)
    if (!result.ok) continue

    httpUrl = url
    manufacturer = detectManufacturer(result.headers, result.body)
    if (manufacturer) break
  }

  const rtspUrl   = rtspOpen ? guessRtspUrl(ip, manufacturer) : null
  const onvifUrl  = httpPorts.length > 0
    ? `http://${ip}${httpPorts[0] === 80 ? '' : `:${httpPorts[0]}`}/onvif/device_service`
    : null

  return {
    manufacturer,
    model: null,
    device_type: manufacturer ? 'ip_camera' : 'generic',
    http_supported: httpPorts.length > 0,
    rtsp_supported: rtspOpen,
    onvif_supported: false, // Will be updated by ONVIF WS-Discovery enrichment
    rtsp_url: rtspUrl,
    onvif_url: onvifUrl,
    http_url: httpUrl,
  }
}
