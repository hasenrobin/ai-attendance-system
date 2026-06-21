import { useEffect, useRef } from 'react'
import './cameraLiveView.css'

export type StreamPlayerStatus = 'connecting' | 'online' | 'offline' | 'error'

export type DirectStreamType = 'hls' | 'mjpeg' | 'external_url'

type CameraStreamPlayerProps = {
  streamType: DirectStreamType
  liveStreamUrl: string
  onStatus: (status: StreamPlayerStatus) => void
}

const EMBEDDABLE_URL_EXTENSIONS = /\.(mp4|webm|ogg|m3u8|mov)(\?.*)?$/i

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

  if (streamType === 'mjpeg') {
    return <MjpegPlayer url={liveStreamUrl} onStatus={onStatus} />
  }

  if (streamType === 'hls') {
    return <HlsPlayer url={liveStreamUrl} onStatus={onStatus} />
  }

  return <ExternalVideoPlayer url={liveStreamUrl} onStatus={onStatus} />
}

type SubPlayerProps = { url: string; onStatus: (status: StreamPlayerStatus) => void }

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
  // Block HLS.js before it even starts when Mixed Content would prevent it.
  if (isMixedContent(url)) {
    return <MixedContentWarning url={url} onStatus={onStatus} />
  }

  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    onStatus('connecting')
    let cancelled = false
    let hls: InstanceType<typeof import('hls.js').default> | null = null

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url

      const handlePlaying = () => onStatus('online')
      const handleError = () => onStatus('offline')

      video.addEventListener('playing', handlePlaying)
      video.addEventListener('error', handleError)

      return () => {
        video.removeEventListener('playing', handlePlaying)
        video.removeEventListener('error', handleError)
        video.removeAttribute('src')
        video.load()
      }
    }

    import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return

      if (!Hls.isSupported()) {
        onStatus('error')
        return
      }

      const instance = new Hls()
      hls = instance

      instance.loadSource(url)
      instance.attachMedia(video)

      instance.on(Hls.Events.MANIFEST_PARSED, () => onStatus('online'))

      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return
        onStatus(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'offline' : 'error')
      })
    })

    return () => {
      cancelled = true
      hls?.destroy()
      hls = null
    }
  }, [url, onStatus])

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