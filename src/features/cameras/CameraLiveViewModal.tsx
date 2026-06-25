import { useCallback, useEffect, useRef, useState } from 'react'
import { LuxuryModal } from '../../components/ui/LuxuryModal'
import { useI18n } from '../../hooks/useI18n'
import type { Camera, CameraStreamTarget } from '../../types/camera'
import { getCameraStreamTarget, getCameraChannels, createCameraHealthLog } from './cameraService'
import { getCloudLiveStream, type CloudCredentialVendor } from './cameraCloudService'
import { CameraStreamPlayer, classifyExternalUrl, type DirectStreamType, type StreamPlayerStatus } from './CameraStreamPlayer'
import './cameraLiveView.css'

type CameraLiveViewModalProps = {
  camera: Camera | null
  onClose: () => void
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'channels'; channels: Camera[] }
  | { kind: 'target'; target: CameraStreamTarget; channels: Camera[] | null }

const DIRECT_STREAM_TYPES: ReadonlySet<string> = new Set(['hls', 'webrtc', 'mjpeg', 'external_url'])

// A camera is the root of an NVR/DVR system (and should show a channel list
// rather than its own player) when it's in nvr_dvr mode with no parent.
// stream_type === 'nvr' is kept as a fallback for rows from before the
// connection_mode backfill.
function isNvrRoot(target: CameraStreamTarget): boolean {
  return (target.connection_mode === 'nvr_dvr' || target.stream_type === 'nvr') && !target.parent_camera_id
}

function CameraOffIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 7l-7 5 7 5V7z" />
      <path d="M1 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H1a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

export function CameraLiveViewModal({ camera, onClose }: CameraLiveViewModalProps) {
  const { t } = useI18n()
  const [state, setState] = useState<ViewState>({ kind: 'loading' })
  const [status, setStatus] = useState<StreamPlayerStatus>('connecting')
  const targetIdRef = useRef<string | null>(null)
  const loggedRef = useRef<{ cameraId: string; status: StreamPlayerStatus } | null>(null)

  useEffect(() => {
    if (!camera) return
    let cancelled = false
    setState({ kind: 'loading' })
    setStatus('connecting')
    targetIdRef.current = null
    loggedRef.current = null

    async function load() {
      const { data, error } = await getCameraStreamTarget(camera!.id)
      if (cancelled) return
      if (error || !data) {
        setState({ kind: 'error', message: error ?? t('cameras.liveView.loadError') })
        return
      }
      if (isNvrRoot(data)) {
        const { data: channels, error: channelsError } = await getCameraChannels(camera!.id)
        if (cancelled) return
        if (channelsError) {
          setState({ kind: 'error', message: channelsError })
          return
        }
        setState({ kind: 'channels', channels })
        return
      }
      targetIdRef.current = data.id
      setState({ kind: 'target', target: data, channels: null })
    }

    load()
    return () => { cancelled = true }
  }, [camera, t])

  const selectChannel = useCallback(async (channelId: string, channels: Camera[]) => {
    setState({ kind: 'loading' })
    setStatus('connecting')
    loggedRef.current = null
    const { data, error } = await getCameraStreamTarget(channelId)
    if (error || !data) {
      setState({ kind: 'error', message: error ?? t('cameras.liveView.loadError') })
      return
    }
    targetIdRef.current = data.id
    setState({ kind: 'target', target: data, channels })
  }, [t])

  const backToChannels = useCallback((channels: Camera[]) => {
    targetIdRef.current = null
    loggedRef.current = null
    setStatus('connecting')
    setState({ kind: 'channels', channels })
  }, [])

  const handleStatus = useCallback((next: StreamPlayerStatus) => {
    setStatus(next)
    if (next === 'connecting') return
    const cameraId = targetIdRef.current
    if (!cameraId) return
    if (loggedRef.current?.cameraId === cameraId && loggedRef.current.status === next) return
    loggedRef.current = { cameraId, status: next }
    void createCameraHealthLog({ camera_id: cameraId, status: next, message: `live_view_${next}` })
  }, [])

  const title = camera ? t('cameras.liveView.modalTitle').replace('{name}', camera.name) : ''

  return (
    <LuxuryModal open={camera !== null} onClose={onClose} title={title} width={720}>
      <div className="clv-body">
        {state.kind === 'loading' && (
          <div className="clv-placeholder">
            <div className="clv-spinner" />
            <div className="clv-placeholder-title">{t('cameras.liveView.loading')}</div>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="clv-placeholder clv-placeholder--error">
            <CameraOffIcon />
            <div className="clv-placeholder-title">{t('cameras.liveView.loadErrorTitle')}</div>
            <div className="clv-placeholder-message">{state.message}</div>
          </div>
        )}

        {state.kind === 'channels' && (
          <ChannelList channels={state.channels} onSelect={ch => selectChannel(ch.id, state.channels)} t={t} />
        )}

        {state.kind === 'target' && (
          <>
            {state.channels && (
              <button className="clv-back-link" onClick={() => backToChannels(state.channels!)}>
                <ArrowLeftIcon /> {t('cameras.liveView.backToChannels')}
              </button>
            )}
            <StreamTargetView target={state.target} status={status} onStatus={handleStatus} t={t} />
          </>
        )}
      </div>
    </LuxuryModal>
  )
}

// ── Channel list (NVR/DVR) ───────────────────────────────────────

type ChannelListProps = {
  channels: Camera[]
  onSelect: (channel: Camera) => void
  t: (key: string) => string
}

function ChannelList({ channels, onSelect, t }: ChannelListProps) {
  if (channels.length === 0) {
    return (
      <div className="clv-placeholder">
        <CameraOffIcon />
        <div className="clv-placeholder-title">{t('cameras.liveView.noChannelsTitle')}</div>
        <div className="clv-placeholder-message">{t('cameras.liveView.noChannelsMessage')}</div>
      </div>
    )
  }

  return (
    <div className="clv-channel-list">
      <div className="clv-channel-list-title">{t('cameras.liveView.channelsTitle')}</div>
      {channels.map(channel => (
        <button key={channel.id} className="clv-channel-item" onClick={() => onSelect(channel)}>
          <span className="clv-channel-info">
            <span className="clv-channel-name">{channel.name}</span>
            {channel.stream_channel && (
              <span className="clv-channel-number">
                {t('cameras.liveView.channelLabel').replace('{number}', channel.stream_channel)}
              </span>
            )}
          </span>
          <ChevronRightIcon />
        </button>
      ))}
    </div>
  )
}

// ── Stream target (player or placeholder) ─────────────────────────

type StreamTargetViewProps = {
  target: CameraStreamTarget
  status: StreamPlayerStatus
  onStatus: (status: StreamPlayerStatus) => void
  t: (key: string) => string
}

function StreamTargetView({ target, status, onStatus, t }: StreamTargetViewProps) {
  const mode = target.connection_mode
  const streamType = target.stream_type

  // Enterprise Direct / Browser Playable, already validated -> player.
  if (streamType && DIRECT_STREAM_TYPES.has(streamType) && target.live_stream_url && streamType !== 'external_url') {
    return (
      <div className="clv-player-wrap">
        <div className="clv-player">
          <CameraStreamPlayer
            streamType={streamType as DirectStreamType}
            liveStreamUrl={target.live_stream_url}
            onStatus={onStatus}
          />
        </div>
        <StatusBadge status={status} t={t} />
      </div>
    )
  }

  if (mode === 'external_url' && target.live_stream_url) {
    return <ExternalUrlView url={target.live_stream_url} status={status} onStatus={onStatus} t={t} />
  }

  // direct_rtsp not yet provisioned (auto-provisioning runs after save, or
  // the provisioning agent is unreachable) -> needs the local proxy.
  if (mode === 'direct_rtsp') {
    return (
      <div className="clv-placeholder clv-placeholder--warning">
        <CameraOffIcon />
        <div className="clv-placeholder-title">{t('cameras.liveView.proxyRequiredTitle')}</div>
        <div className="clv-placeholder-message">{t('cameras.liveView.proxyRequiredMessage')}</div>
      </div>
    )
  }

  if (mode === 'onvif') {
    return (
      <div className="clv-placeholder clv-placeholder--warning">
        <CameraOffIcon />
        <div className="clv-placeholder-title">{t('cameras.liveView.onvifNotProvisionedTitle')}</div>
        <div className="clv-placeholder-message">{t('cameras.liveView.onvifNotProvisionedMessage')}</div>
      </div>
    )
  }

  if (mode === 'nvr_dvr') {
    return (
      <div className="clv-placeholder clv-placeholder--warning">
        <CameraOffIcon />
        <div className="clv-placeholder-title">{t('cameras.liveView.nvrChannelNotProvisionedTitle')}</div>
        <div className="clv-placeholder-message">{t('cameras.liveView.nvrChannelNotProvisionedMessage')}</div>
      </div>
    )
  }

  if (mode === 'webrtc') {
    return (
      <div className="clv-placeholder clv-placeholder--warning">
        <CameraOffIcon />
        <div className="clv-placeholder-title">{t('cameras.liveView.webrtcGatewayMissingTitle')}</div>
        <div className="clv-placeholder-message">{t('cameras.liveView.webrtcGatewayMissingMessage')}</div>
      </div>
    )
  }

  // EZVIZ/IMOU: real adapter exists (camera-cloud-adapter Edge Function) --
  // fetch a fresh, short-lived HLS URL and play it. Never falls back to a
  // placeholder unless the adapter itself reports a problem.
  if (mode === 'ezviz_cloud' || mode === 'imou_cloud') {
    return <CloudLiveStreamView target={target} status={status} onStatus={onStatus} t={t} />
  }

  // Hikvision/Dahua: Partner Access Required for every account, by design
  // (CAMERA_CLOUD_VENDOR_AUDIT.md sections 3-4). Fixed verdict -- no adapter
  // call needed to know the outcome.
  if (mode === 'hikvision_p2p' || mode === 'dahua_p2p') {
    const reasonKey = mode === 'hikvision_p2p' ? 'partnerAccessRequiredHikvision' : 'partnerAccessRequiredDahua'
    return (
      <div className="clv-placeholder clv-placeholder--warning">
        <CameraOffIcon />
        <div className="clv-placeholder-title">{t('cameras.liveView.partnerAccessRequiredTitle')}</div>
        <div className="clv-placeholder-message">{t(`cameras.notices.${reasonKey}`)}</div>
      </div>
    )
  }

  // generic_cloud: vendor selected is not one of the 4 audited vendors -- no
  // adapter exists to build against (CAMERA_CLOUD_VENDOR_AUDIT.md,
  // "Implementation status vocabulary").
  if (mode === 'generic_cloud') {
    return (
      <div className="clv-placeholder clv-placeholder--warning">
        <CameraOffIcon />
        <div className="clv-placeholder-title">{t('cameras.liveView.cloudAdapterPendingTitle')}</div>
        <div className="clv-placeholder-message">{t('cameras.liveView.cloudAdapterPendingMessage')}</div>
      </div>
    )
  }

  return (
    <div className="clv-placeholder">
      <CameraOffIcon />
      <div className="clv-placeholder-title">{t('cameras.liveView.notConfiguredTitle')}</div>
      <div className="clv-placeholder-message">{t('cameras.liveView.notConfiguredMessage')}</div>
    </div>
  )
}

// ── Cloud stream (EZVIZ/IMOU live HLS via camera-cloud-adapter) ────

type CloudStreamState =
  | { kind: 'loading' }
  | { kind: 'ready'; url: string }
  | { kind: 'credentials_required' }
  | { kind: 'unavailable'; message: string }

// Fetches a fresh, short-lived HLS URL from camera-cloud-adapter's
// get_live_stream action every time the modal opens for this camera --
// EZVIZ/IMOU stream URLs embed short-lived tokens and must never be cached
// or persisted (cameraCloudService.getCloudLiveStream).
function CloudLiveStreamView({ target, status, onStatus, t }: StreamTargetViewProps) {
  const [state, setState] = useState<CloudStreamState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })

    const deviceId = target.cloud_device_id?.trim()
    if (!deviceId) {
      setState({ kind: 'unavailable', message: t('cameras.liveView.notConfiguredMessage') })
      return
    }

    const vendor: CloudCredentialVendor = target.connection_mode === 'imou_cloud' ? 'imou' : 'ezviz'

    getCloudLiveStream({ companyId: target.company_id, cameraId: target.id, vendor, deviceId }).then(result => {
      if (cancelled) return
      if (result.ok) {
        setState({ kind: 'ready', url: result.stream.url })
      } else if (result.status === 'credentials_required' || result.status === 'token_invalid') {
        setState({ kind: 'credentials_required' })
      } else {
        setState({ kind: 'unavailable', message: result.error })
      }
    })

    return () => { cancelled = true }
  }, [target.id, target.connection_mode, target.cloud_device_id, target.company_id, t])

  if (state.kind === 'loading') {
    return (
      <div className="clv-placeholder">
        <div className="clv-spinner" />
        <div className="clv-placeholder-title">{t('cameras.liveView.loading')}</div>
      </div>
    )
  }

  if (state.kind === 'ready') {
    return (
      <div className="clv-player-wrap">
        <div className="clv-player">
          <CameraStreamPlayer streamType="hls" liveStreamUrl={state.url} onStatus={onStatus} />
        </div>
        <StatusBadge status={status} t={t} />
      </div>
    )
  }

  if (state.kind === 'credentials_required') {
    return (
      <div className="clv-placeholder clv-placeholder--warning">
        <CameraOffIcon />
        <div className="clv-placeholder-title">{t('cameras.liveView.cloudCredentialsRequiredTitle')}</div>
        <div className="clv-placeholder-message">{t('cameras.liveView.cloudCredentialsRequiredMessage')}</div>
      </div>
    )
  }

  return (
    <div className="clv-placeholder clv-placeholder--warning">
      <CameraOffIcon />
      <div className="clv-placeholder-title">{t('cameras.liveView.cloudStreamUnavailableTitle')}</div>
      <div className="clv-placeholder-message">{state.message}</div>
    </div>
  )
}

// ── External URL (render-time embeddable detection) ───────────────

function ExternalUrlView({ url, status, onStatus, t }: { url: string; status: StreamPlayerStatus; onStatus: (status: StreamPlayerStatus) => void; t: (key: string) => string }) {
  const [embeddable, setEmbeddable] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    setEmbeddable(null)
    classifyExternalUrl(url).then(result => {
      if (!cancelled) setEmbeddable(result)
    })
    return () => { cancelled = true }
  }, [url])

  if (embeddable === null) {
    return (
      <div className="clv-placeholder">
        <div className="clv-spinner" />
        <div className="clv-placeholder-title">{t('cameras.liveView.loading')}</div>
      </div>
    )
  }

  if (embeddable) {
    return (
      <div className="clv-player-wrap">
        <div className="clv-player">
          <CameraStreamPlayer streamType="external_url" liveStreamUrl={url} onStatus={onStatus} />
        </div>
        <StatusBadge status={status} t={t} />
      </div>
    )
  }

  return (
    <div className="clv-placeholder">
      <CameraOffIcon />
      <div className="clv-placeholder-title">{t('cameras.liveView.externalNotEmbeddableTitle')}</div>
      <div className="clv-placeholder-message">{t('cameras.liveView.externalNotEmbeddableMessage')}</div>
      <button className="clv-open-external-btn" onClick={() => window.open(url, '_blank', 'noopener')}>
        {t('cameras.liveView.openExternal')}
      </button>
    </div>
  )
}

function StatusBadge({ status, t }: { status: StreamPlayerStatus; t: (key: string) => string }) {
  return (
    <div className={`clv-status clv-status--${status}`}>
      <span className="clv-status-dot" />
      {t(`cameras.liveView.status.${status}`)}
    </div>
  )
}
