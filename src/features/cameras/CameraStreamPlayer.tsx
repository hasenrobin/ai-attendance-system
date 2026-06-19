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

function HlsPlayer({ url, onStatus }: SubPlayerProps) {
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