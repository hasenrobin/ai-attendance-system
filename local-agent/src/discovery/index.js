// ============================================================================
// Discovery Orchestrator
//
// Coordinates subnet detection, ONVIF WS-Discovery, port scanning, and
// camera fingerprinting into a single scan. Writes results incrementally
// to Supabase as each device is processed.
// ============================================================================

import { supabase } from '../supabaseClient.js'
import { AGENT_COMPANY_ID, SCAN_CONCURRENCY, isPrivateIp } from '../config.js'
import { detectLocalSubnets, hostsInSubnet, parseScanRange } from './subnetDetect.js'
import { scanSubnet } from './portScanner.js'
import { runWsDiscovery } from './onvifDiscovery.js'
import { fingerprintCamera } from './fingerprint.js'

// Write a single discovered device to Supabase
async function writeResult(jobId, ip, openPorts, fingerprint, onvifXaddrs) {
  const { error } = await supabase
    .from('camera_discovery_results')
    .insert({
      job_id:          jobId,
      company_id:      AGENT_COMPANY_ID,
      ip_address:      ip,
      manufacturer:    fingerprint.manufacturer,
      model:           fingerprint.model,
      device_type:     fingerprint.device_type,
      onvif_supported: onvifXaddrs.length > 0 || fingerprint.onvif_supported,
      rtsp_supported:  fingerprint.rtsp_supported,
      http_supported:  fingerprint.http_supported,
      rtsp_url:        fingerprint.rtsp_url,
      onvif_url:       onvifXaddrs[0] ?? fingerprint.onvif_url,
      http_url:        fingerprint.http_url,
      open_ports:      openPorts,
      reachable:       true,
      raw_data:        { xaddrs: onvifXaddrs, open_ports: openPorts },
    })

  if (error) {
    console.error(`[discovery] Failed to write result for ${ip}: ${error.message}`)
  } else {
    console.log(`[discovery] Found: ${ip} [${fingerprint.manufacturer ?? 'unknown'}] ports=${openPorts.join(',')}`)
  }
}

// Increment the devices_found counter on the job row
async function incrementJobCount(jobId) {
  await supabase.rpc('', {}).catch(() => {})
  // Use a raw update with increment — RPC not needed, just fetch+update
  const { data } = await supabase
    .from('camera_discovery_jobs')
    .select('devices_found')
    .eq('id', jobId)
    .single()
  const current = data?.devices_found ?? 0
  await supabase
    .from('camera_discovery_jobs')
    .update({ devices_found: current + 1 })
    .eq('id', jobId)
}

export async function runDiscovery(job, signal) {
  const jobId = job.id

  // --- Phase 1: ONVIF WS-Discovery (parallel, fast) ---
  console.log('[discovery] Phase 1: ONVIF WS-Discovery...')
  const wsDevices = await runWsDiscovery().catch(err => {
    console.warn('[discovery] WS-Discovery error:', err.message)
    return []
  })
  console.log(`[discovery] WS-Discovery found ${wsDevices.length} ONVIF device(s)`)

  // Build a map of ip → onvif XAddrs from WS-Discovery
  const onvifByIp = new Map()
  for (const dev of wsDevices) {
    onvifByIp.set(dev.ip, dev.xaddrs)
  }

  // --- Phase 2: Determine subnets to scan ---
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
    console.warn('[discovery] No private subnets detected — skipping port scan')
    return
  }

  // Add IPs discovered via WS-Discovery to the scan even if on a different subnet
  const wsOnlyIps = [...onvifByIp.keys()].filter(
    ip => isPrivateIp(ip) && !subnets.some(b => ip.startsWith(b + '.'))
  )

  // --- Phase 3: Port scan ---
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

      // If WS-Discovery found this device, mark it as ONVIF supported
      if (xaddrs.length > 0) fingerprint.onvif_supported = true

      await writeResult(jobId, ip, openPorts, fingerprint, xaddrs)
      await incrementJobCount(jobId)
    },
  })

  // Write any WS-Discovery devices that didn't respond to port scan
  // (some ONVIF devices close HTTP ports but respond to WS-Discovery)
  for (const [ip, xaddrs] of onvifByIp) {
    if (signal?.aborted) break
    const { data: existing } = await supabase
      .from('camera_discovery_results')
      .select('id')
      .eq('job_id', jobId)
      .eq('ip_address', ip)
      .maybeSingle()
    if (existing) continue // already written by port scan

    if (!isPrivateIp(ip)) continue

    const fingerprint = {
      manufacturer: null, model: null, device_type: 'ip_camera',
      onvif_supported: true, rtsp_supported: false, http_supported: false,
      rtsp_url: null, onvif_url: xaddrs[0] ?? null, http_url: null,
    }
    await writeResult(jobId, ip, [], fingerprint, xaddrs)
    await incrementJobCount(jobId)
  }
}
