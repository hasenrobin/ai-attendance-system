import { useCallback, useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import './cameraLiveView.css'

export type StreamPlayerStatus =
  | 'connecting'
  | 'live_webrtc'
  | 'falling_back_hls'
  | 'live_hls'
  | 'reconnecting'
  | 'online'
  | 'offline'
  | 'error'

export type DirectStreamType = 'hls' | 'webrtc' | 'mjpeg' | 'external_url'

type CameraStreamPlayerProps = {
  streamType: DirectStreamType
  liveStreamUrl: string
  onStatus: (status: StreamPlayerStatus) => void
}

const EMBEDDABLE_URL_EXTENSIONS = /\.(mp4|webm|ogg|m3u8|mov)(\?.*)?$/i
const HLS_URL_EXTENSION = /\.m3u8(\?.*)?$/i
const WHEP_URL_EXTENSION = /\/whep(\?.*)?$/i

function getUrlScheme(url: string): string | null {
  const match = url.trim().match(/^([a-z][a-z0-9+.-]*):\/\//i)
  return match ? match[1].toLowerCase() : null
}

function isHttpUrl(url: string): boolean {
  const scheme = getUrlScheme(url)
  return scheme === 'http' || scheme === 'https'
}

function isUnsupportedBrowserStream(url: string): boolean {
  const scheme = getUrlScheme(url)
  return scheme === 'rtsp' || scheme === 'rtmp' || scheme === 'onvif'
}

function UnsupportedStreamMessage({ onStatus }: { onStatus: (status: StreamPlayerStatus) => void }) {
  useEffect(() => {
    onStatus('error')
  }, [onStatus])

  return (
    <div className="clv-media clv-media--video" style={{ display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>RTSP لا يعمل مباشرة داخل المتصفح</div>
        <div style={{ opacity: 0.75, lineHeight: 1.7 }}>
          يجب تحويل رابط الكاميرا إلى HLS عبر FFmpeg / MediaMTX ثم استخدام رابط
          <br />
          يبدأ بـ http:// أو https:// وينتهي غالباً بـ .m3u8
        </div>
      </div>
    </div>
  )
}

function UnsupportedHlsMessage({ onStatus }: { onStatus: (status: StreamPlayerStatus) => void }) {
  useEffect(() => {
    onStatus('error')
  }, [onStatus])

  return (
    <div className="clv-media clv-media--video" style={{ display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>HLS playback is not supported in this browser</div>
        <div style={{ opacity: 0.75, lineHeight: 1.7 }}>
          This browser cannot play the camera HLS stream. Try a modern Chrome, Edge, Safari, or Firefox browser.
        </div>
      </div>
    </div>
  )
}

export async function classifyExternalUrl(url: string): Promise<boolean> {
  if (!isHttpUrl(url)) return false
  if (EMBEDDABLE_URL_EXTENSIONS.test(url)) return true

  try {
    const response = await fetch(url, { method: 'HEAD' })
    const contentType = response.headers.get('content-type') ?? ''
    return contentType.startsWith('video/') || contentType.includes('mpegurl')
  } catch {
    return false
  }
}

export function CameraStreamPlayer({ streamType, liveStreamUrl, onStatus }: CameraStreamPlayerProps) {
  if (!liveStreamUrl.trim() || isUnsupportedBrowserStream(liveStreamUrl) || !isHttpUrl(liveStreamUrl)) {
    return <UnsupportedStreamMessage onStatus={onStatus} />
  }

  if (streamType === 'webrtc' || WHEP_URL_EXTENSION.test(liveStreamUrl)) {
    return <WebRtcPlayerWithFallback url={liveStreamUrl} onStatus={onStatus} />
  }

  if (streamType === 'hls' || HLS_URL_EXTENSION.test(liveStreamUrl)) {
    return <HlsPlayer url={liveStreamUrl} onStatus={onStatus} />
  }

  if (streamType === 'mjpeg') {
    return <MjpegPlayer url={liveStreamUrl} onStatus={onStatus} />
  }

  return <ExternalVideoPlayer url={liveStreamUrl} onStatus={onStatus} />
}

type SubPlayerProps = { url: string; onStatus: (status: StreamPlayerStatus) => void }

function hlsFallbackUrlForWebRtc(whepUrl: string): string | null {
  try {
    const url = new URL(whepUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    const webrtcIndex = parts.indexOf('camera-webrtc')
    if (webrtcIndex === -1 || !parts[webrtcIndex + 1]) return null
    const pathName = parts[webrtcIndex + 1]
    url.pathname = `/camera-hls/${pathName}/index.m3u8`
    url.search = ''
    return url.toString()
  } catch {
    return null
  }
}

function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise(resolve => {
    const timeout = window.setTimeout(done, 2500)
    function done() {
      window.clearTimeout(timeout)
      pc.removeEventListener('icegatheringstatechange', handleChange)
      resolve()
    }
    function handleChange() {
      if (pc.iceGatheringState === 'complete') done()
    }
    pc.addEventListener('icegatheringstatechange', handleChange)
  })
}

function WebRtcPlayerWithFallback({ url, onStatus }: SubPlayerProps) {
  const [fallbackUrl, setFallbackUrl] = useState<string | null | undefined>(undefined)
  const handleFallback = useCallback(() => {
    console.warn(`[webrtc-player] fallback trigger url=${url}`)
    setFallbackUrl(hlsFallbackUrlForWebRtc(url))
  }, [url])

  const handleHlsFallbackStatus = useCallback((status: StreamPlayerStatus) => {
    if (status === 'online') onStatus('live_hls')
    else if (status === 'connecting') onStatus('falling_back_hls')
    else onStatus(status)
  }, [onStatus])

  if (fallbackUrl) {
    return <HlsPlayer url={fallbackUrl} onStatus={handleHlsFallbackStatus} />
  }

  if (fallbackUrl === null) {
    return <UnsupportedHlsMessage onStatus={onStatus} />
  }

  return <WebRtcPlayer url={url} onStatus={onStatus} onFallback={handleFallback} />
}

function WebRtcPlayer({ url, onStatus, onFallback }: SubPlayerProps & { onFallback: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onStatusRef = useRef(onStatus)
  const onFallbackRef = useRef(onFallback)

  useEffect(() => {
    onStatusRef.current = onStatus
    onFallbackRef.current = onFallback
  }, [onStatus, onFallback])

  useEffect(() => {
    let cancelled = false
    let pc: RTCPeerConnection | null = null

    function setPlayerStatus(status: StreamPlayerStatus) {
      onStatusRef.current(status)
    }

    function triggerFallback(reason: string) {
      console.warn(`[webrtc-player] fallback reason=${reason} url=${url}`)
      setPlayerStatus('falling_back_hls')
      onFallbackRef.current()
    }

    async function connect() {
      const video = videoRef.current
      if (!video) return

      if (isMixedContent(url)) {
        triggerFallback('mixed_content')
        return
      }

      console.log(`[webrtc-player] create peer connection url=${url}`)
      setPlayerStatus('connecting')
      pc = new RTCPeerConnection()
      const remoteStream = new MediaStream()
      video.srcObject = remoteStream

      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.addTransceiver('audio', { direction: 'recvonly' })

      pc.ontrack = event => {
        for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
          if (!remoteStream.getTracks().some(existing => existing.id === track.id)) {
            remoteStream.addTrack(track)
          }
        }
      }

      pc.onconnectionstatechange = () => {
        if (!pc || cancelled) return
        if (pc.connectionState === 'connected') {
          console.log(`[webrtc-player] connected url=${url}`)
          setPlayerStatus('live_webrtc')
        } else if (pc.connectionState === 'connecting') setPlayerStatus('connecting')
        else if (pc.connectionState === 'disconnected') setPlayerStatus('reconnecting')
        else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          triggerFallback(`connection_${pc.connectionState}`)
        }
      }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await waitForIceGatheringComplete(pc)
      if (cancelled || !pc.localDescription) return

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          'Accept': 'application/sdp',
        },
        body: pc.localDescription.sdp,
      })

      if (!response.ok) {
        throw new Error(`WHEP handshake failed with HTTP ${response.status}`)
      }

      const answer = await response.text()
      if (cancelled) return
      await pc.setRemoteDescription({ type: 'answer', sdp: answer })
      void video.play().catch(() => undefined)
    }

    connect().catch(() => {
      if (!cancelled) {
        triggerFallback('connect_error')
      }
    })

    return () => {
      cancelled = true
      console.log(`[webrtc-player] teardown url=${url}`)
      pc?.close()
      const video = videoRef.current
      if (video) {
        video.srcObject = null
        video.removeAttribute('src')
        video.load()
      }
    }
  }, [url])

  return (
    <video
      key={url}
      ref={videoRef}
      className="clv-media clv-media--video"
      controls
      autoPlay
      muted
      playsInline
    />
  )
}

function MjpegPlayer({ url, onStatus }: SubPlayerProps) {
  useEffect(() => {
    onStatus('connecting')
  }, [url, onStatus])

  return (
    <img
      key={url}
      className="clv-media clv-media--image"
      src={url}
      alt=""
      onLoad={() => onStatus('online')}
      onError={() => onStatus('offline')}
    />
  )
}

function ExternalVideoPlayer({ url, onStatus }: SubPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    onStatus('connecting')
  }, [url, onStatus])

  function handleError() {
    const code = videoRef.current?.error?.code
    onStatus(code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? 'error' : 'offline')
  }

  return (
    <video
      key={url}
      ref={videoRef}
      className="clv-media clv-media--video"
      src={url}
      controls
      autoPlay
      muted
      playsInline
      onPlaying={() => onStatus('online')}
      onError={handleError}
    />
  )
}

// Detects the Mixed Content scenario: HTTPS page trying to load an HTTP
// stream URL. Browsers enforce Mixed Content policy and silently block the
// fetch, causing HLS.js to emit a fatal NETWORK_ERROR with no user-visible
// explanation. We intercept before HLS.js even starts and show a clear
// message with the direct stream URL so the user can open it in VLC or a
// native player.
function isMixedContent(url: string): boolean {
  return typeof window !== 'undefined'
    && window.location.protocol === 'https:'
    && url.startsWith('http://')
}

function MixedContentWarning({ url, onStatus }: SubPlayerProps) {
  useEffect(() => { onStatus('offline') }, [onStatus])

  function copyUrl() {
    navigator.clipboard?.writeText(url).catch(() => undefined)
  }

  return (
    <div className="clv-media clv-media--video" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', textAlign: 'center', padding: '28px 24px', gap: 12,
    }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        style={{ opacity: 0.45 }}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div style={{ fontWeight: 700, fontSize: 14 }}>البث محجوب بسياسة المتصفح</div>
      <div style={{ opacity: 0.65, fontSize: 12, lineHeight: 1.65, maxWidth: 340 }}>
        الموقع يعمل على HTTPS لكن رابط البث HTTP —
        المتصفح يمنع تحميل موارد غير آمنة (Mixed Content).
        افتح الرابط مباشرة في VLC أو مشغّل آخر.
      </div>
      <div style={{
        background: 'rgba(255,255,255,0.06)', borderRadius: 6,
        padding: '8px 12px', fontSize: 11, wordBreak: 'break-all',
        color: 'var(--color-text-muted)', maxWidth: '100%',
      }}>
        {url}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <a href={url} target="_blank" rel="noopener noreferrer"
          style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 12,
            background: 'var(--color-gold)', color: '#000', fontWeight: 600,
            textDecoration: 'none', display: 'inline-block',
          }}>
          فتح في تبويب جديد
        </a>
        <button onClick={copyUrl}
          style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 12,
            background: 'rgba(255,255,255,0.1)', color: 'var(--color-text-primary)',
            border: 'none', cursor: 'pointer',
          }}>
          نسخ الرابط
        </button>
      </div>
    </div>
  )
}

function HlsPlayer({ url, onStatus }: SubPlayerProps) {
  // Hooks must always be called unconditionally (Rules of Hooks).
  const videoRef = useRef<HTMLVideoElement>(null)
  const mixed    = isMixedContent(url)
  const [unsupported, setUnsupported] = useState(false)

  useEffect(() => {
    setUnsupported(false)

    // Mixed Content: browser on HTTPS cannot load HTTP stream.
    // Report offline and let the MixedContentWarning below handle the UI.
    if (mixed) {
      onStatus('offline')
      return
    }

    const video = videoRef.current
    if (!video) return

    onStatus('connecting')
    let hls: Hls | null = null

    if (Hls.isSupported()) {
      hls = new Hls()
      hls.loadSource(url)
      hls.attachMedia(video)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => undefined)
        onStatus('online')
      })

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return
        onStatus(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'offline' : 'error')
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url

      const handlePlaying = () => onStatus('online')
      const handleError   = () => onStatus('offline')

      video.addEventListener('playing', handlePlaying)
      video.addEventListener('error',   handleError)

      return () => {
        video.removeEventListener('playing', handlePlaying)
        video.removeEventListener('error',   handleError)
        video.removeAttribute('src')
        video.load()
      }
    } else {
      setUnsupported(true)
      onStatus('error')
    }

    return () => {
      hls?.destroy()
      hls = null
      video.removeAttribute('src')
      video.load()
    }
  }, [url, onStatus, mixed])

  // Conditional rendering after all hooks — Rules of Hooks satisfied.
  if (mixed) {
    return <MixedContentWarning url={url} onStatus={onStatus} />
  }

  if (unsupported) {
    return <UnsupportedHlsMessage onStatus={onStatus} />
  }

  return (
    <video
      key={url}
      ref={videoRef}
      className="clv-media clv-media--video"
      controls
      autoPlay
      muted
      playsInline
    />
  )
}
