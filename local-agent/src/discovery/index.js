// ============================================================================
// Discovery Orchestrator
//
// Coordinates subnet detection, ONVIF WS-Discovery, port scanning, and camera
// fingerprinting. Phase 3D no longer writes directly to Supabase; callers pass
// an onResult callback that forwards results through Agent API.
// ============================================================================

import { SCAN_CONCURRENCY, isPrivateIp } from '../config.js'
import { detectLocalSubnets, hostsInSubnet, parseScanRange } from './subnetDetect.js'
import { scanSubnet } from './portScanner.js'
import { runWsDiscovery } from './onvifDiscovery.js'
import { fingerprintCamera } from './fingerprint.js'

function buildResult(ip, openPorts, fingerprint, onvifXaddrs) {
  return {
    ip_address: ip,
    manufacturer: fingerprint.manufacturer,
    model: fingerprint.model,
    device_type: fingerprint.device_type,
    onvif_supported: onvifXaddrs.length > 0 || fingerprint.onvif_supported,
    rtsp_supported: fingerprint.rtsp_supported,
    http_supported: fingerprint.http_supported,
    rtsp_url: fingerprint.rtsp_url,
    onvif_url: onvifXaddrs[0] ?? fingerprint.onvif_url,
    http_url: fingerprint.http_url,
    open_ports: openPorts,
    reachable: true,
    raw_data: { xaddrs: onvifXaddrs, open_ports: openPorts },
  }
}

async function emitResult(result, onResult) {
  await onResult?.(result)
  console.log(`[discovery] Found: ${result.ip_address} [${result.manufacturer ?? 'unknown'}] ports=${result.open_ports.join(',')}`)
}

export async function runDiscovery(job, signal, options = {}) {
  const onResult = options.onResult
  const seenIps = new Set()

  console.log('[discovery] Phase 1: ONVIF WS-Discovery...')
  const wsDevices = await runWsDiscovery().catch(err => {
    console.warn('[discovery] WS-Discovery error:', err.message)
    return []
  })
  console.log(`[discovery] WS-Discovery found ${wsDevices.length} ONVIF device(s)`)

  const onvifByIp = new Map()
  for (const dev of wsDevices) {
    onvifByIp.set(dev.ip, dev.xaddrs)
  }

  let subnets = []
  const customRange = parseScanRange(job.scan_range)
  if (customRange) {
    subnets = [customRange]
    console.log(`[discovery] Using custom scan range: ${customRange}.0/24`)
  } else {
    subnets = detectLocalSubnets()
    console.log(`[discovery] Auto-detected ${subnets.length} subnet(s): ${subnets.map(s => `${s}.0/24`).join(', ')}`)
  }

  if (subnets.length === 0) {
    console.warn('[discovery] No private subnets detected - skipping port scan')
    return
  }

  const wsOnlyIps = [...onvifByIp.keys()].filter(
    ip => isPrivateIp(ip) && !subnets.some(b => ip.startsWith(b + '.')),
  )

  const allIps = [
    ...new Set([
      ...subnets.flatMap(hostsInSubnet),
      ...wsOnlyIps,
    ]),
  ]

  console.log(`[discovery] Port scanning ${allIps.length} IP(s) with concurrency=${SCAN_CONCURRENCY}...`)

  await scanSubnet(allIps, {
    concurrency: SCAN_CONCURRENCY,
    signal,
    onResult: async (ip, openPorts) => {
      if (signal?.aborted) return

      const xaddrs = onvifByIp.get(ip) ?? []
      const fingerprint = await fingerprintCamera(ip, openPorts)
      if (xaddrs.length > 0) fingerprint.onvif_supported = true

      const result = buildResult(ip, openPorts, fingerprint, xaddrs)
      seenIps.add(ip)
      await emitResult(result, onResult)
    },
  })

  for (const [ip, xaddrs] of onvifByIp) {
    if (signal?.aborted) break
    if (seenIps.has(ip)) continue
    if (!isPrivateIp(ip)) continue

    const result = buildResult(ip, [], {
      manufacturer: null,
      model: null,
      device_type: 'ip_camera',
      onvif_supported: true,
      rtsp_supported: false,
      http_supported: false,
      rtsp_url: null,
      onvif_url: xaddrs[0] ?? null,
      http_url: null,
    }, xaddrs)
    seenIps.add(ip)
    await emitResult(result, onResult)
  }
}
