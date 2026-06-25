const AGENT_BASE = import.meta.env.VITE_PROVISIONING_AGENT_URL ?? 'http://127.0.0.1:8787'

// Provisioning involves ffprobe + MediaMTX API calls + polling for HLS to
// come up (which can take longer when ffmpeg has to start transcoding).
const PROVISION_TIMEOUT_MS = 40_000

// Reachability-only probe for an NVR/DVR parent (TCP connect, no MediaMTX).
const NVR_PARENT_VALIDATE_TIMEOUT_MS = 10_000

// Summary of one ONVIF media profile — safe to send to the browser (no
// credentials, no raw stream URI).
export type OnvifProfileSummary = {
  name: string
  token: string | null
  resolution: string | null
  encoding: string | null
}

export type ProvisionResult =
  | {
      ok: true
      mode: string
      stage: 'done'
      streamType: 'hls' | 'webrtc'
      liveStreamUrl: string
      hlsFallbackUrl?: string | null
      webrtcUrl?: string | null
      publishTransport?: 'srt' | 'rtsp' | string
      transcoded: boolean
      videoCodec: string | null
      audioCodec: string | null
      warnings: string[]
      error: null
      rtspUrlResolved: string | null
      needsTranscode: boolean
      healthStatus: string
      onvifProfiles?: OnvifProfileSummary[] | null
      onvifSelectedProfile?: OnvifProfileSummary | null
    }
  | {
      ok: false
      mode?: string
      stage: string
      error: string
      rtspUrlResolved?: string | null
      needsTranscode?: null
      healthStatus?: string
      onvifProfiles?: OnvifProfileSummary[] | null
      onvifSelectedProfile?: OnvifProfileSummary | null
      onvifPipelineStage?: string
    }

type ProvisionParams = {
  cameraId: string
  mode?: 'direct_rtsp' | 'onvif' | 'nvr_channel'
  // direct_rtsp
  rtspUrl?: string
  username?: string
  password?: string
  // onvif
  onvif_url?: string
  ip?: string
  port?: number
  // nvr_channel
  channelValue?: string
  nvrHost?: string
  nvrPort?: number
  nvrUsername?: string
  nvrPassword?: string
  nvrChannel?: string
}

// Talks to the Local Customer Agent provisioning API. The API contract is
// intentionally the same as the earlier camera-proxy/provisioning-agent:
// validate RTSP (direct, ONVIF-discovered, or NVR-channel-resolved), detect
// codec, create/update the MediaMTX path, and verify HLS playback.
export async function provisionCamera(params: ProvisionParams): Promise<ProvisionResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROVISION_TIMEOUT_MS)

  try {
    const response = await fetch(`${AGENT_BASE}/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    })

    return (await response.json()) as ProvisionResult
  } catch {
    return {
      ok: false,
      stage: 'agent_unreachable',
      error: 'Could not reach the camera provisioning agent.',
    }
  } finally {
    clearTimeout(timer)
  }
}

// Pure TCP-reachability probe for an NVR/DVR parent record's management/RTSP
// host:port. Never provisions anything — an NVR parent has no stream of its
// own, so this is the only check that can make its status "Validated".
export async function validateNvrParent(params: { host: string; port?: number }): Promise<{
  reachable: boolean
  reason: string | null
  agentUnreachable: boolean
}> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NVR_PARENT_VALIDATE_TIMEOUT_MS)

  try {
    const response = await fetch(`${AGENT_BASE}/validate/nvr-parent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    })

    const data = (await response.json()) as { reachable: boolean; reason: string | null }
    return { reachable: data.reachable, reason: data.reason, agentUnreachable: false }
  } catch {
    return { reachable: false, reason: 'Provisioning agent unreachable', agentUnreachable: true }
  } finally {
    clearTimeout(timer)
  }
}
