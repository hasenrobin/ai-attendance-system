import {
  ALLOWED_ORIGINS,
  CLOUD_RTSP_MODE,
  FFPROBE_PATH,
  FFPROBE_TIMEOUT_MS,
  HLS_VERIFY_INTERVAL_MS,
  HLS_VERIFY_TIMEOUT_MS,
  LOCAL_FFMPEG_PATH,
  MEDIAMTX_API_BASE,
  MEDIAMTX_API_TIMEOUT_MS,
  MEDIAMTX_HLS_BASE,
  MEDIAMTX_HLS_PUBLIC_URL_LOCAL,
  MEDIAMTX_RTSP_BASE,
  MEDIAMTX_SRT_PUBLISH_URL,
  MEDIAMTX_WEBRTC_PUBLIC_URL,
  MEDIAMTX_YML_PATH,
  NVR_PARENT_CHECK_TIMEOUT_MS,
  ONVIF_CONNECT_TIMEOUT_MS,
  ONVIF_DEFAULT_PATH,
  ONVIF_DEFAULT_PORT,
  PROVISIONING_API_HOST,
  PROVISIONING_API_PORT,
  PROVISIONING_SHUTDOWN_SECRET,
  RTSP_DEFAULT_PORT,
} from '../config.js'

export {
  ALLOWED_ORIGINS,
  CLOUD_RTSP_MODE,
  FFPROBE_PATH,
  FFPROBE_TIMEOUT_MS,
  HLS_VERIFY_INTERVAL_MS,
  HLS_VERIFY_TIMEOUT_MS,
  MEDIAMTX_API_BASE,
  MEDIAMTX_API_TIMEOUT_MS,
  MEDIAMTX_HLS_BASE,
  MEDIAMTX_RTSP_BASE,
  MEDIAMTX_SRT_PUBLISH_URL,
  MEDIAMTX_WEBRTC_PUBLIC_URL,
  MEDIAMTX_YML_PATH,
  NVR_PARENT_CHECK_TIMEOUT_MS,
  ONVIF_CONNECT_TIMEOUT_MS,
  ONVIF_DEFAULT_PATH,
  ONVIF_DEFAULT_PORT,
  PROVISIONING_SHUTDOWN_SECRET,
  RTSP_DEFAULT_PORT,
}

export const AGENT_HOST = PROVISIONING_API_HOST
export const AGENT_PORT = PROVISIONING_API_PORT
export const FFMPEG_PATH = LOCAL_FFMPEG_PATH
export const MEDIAMTX_HLS_PUBLIC_URL = MEDIAMTX_HLS_PUBLIC_URL_LOCAL
export const SRT_PUBLISH_BASE_URL = MEDIAMTX_SRT_PUBLISH_URL
export const WEBRTC_PUBLIC_BASE_URL = MEDIAMTX_WEBRTC_PUBLIC_URL

// Passthrough: copy H.264 stream to the publish RTSP URL without re-encoding.
// Used in cloud mode for cameras already in H.264 so no CPU is wasted on transcode.
export function buildPassthroughArgs(sourceRtspUrl, outputRtspUrl) {
  return [
    '-rtsp_transport', 'tcp',
    '-i', sourceRtspUrl,
    '-c', 'copy',
    '-f', 'rtsp',
    '-rtsp_transport', 'tcp',
    outputRtspUrl,
  ]
}

export function buildTranscodeArgs(sourceRtspUrl, outputRtspUrl) {
  return [
    '-rtsp_transport', 'tcp',
    '-i', sourceRtspUrl,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=1280:-2',
    '-r', '15',
    '-g', '30',
    '-keyint_min', '30',
    '-sc_threshold', '0',
    '-b:v', '1200k',
    '-maxrate', '1200k',
    '-bufsize', '2400k',
    '-c:a', 'aac',
    '-ar', '44100',
    '-ac', '1',
    '-b:a', '64k',
    '-f', 'rtsp',
    '-rtsp_transport', 'tcp',
    outputRtspUrl,
  ]
}

// SRT ingest path used for production cloud streaming. We intentionally
// transcode to browser-safe H.264 baseline and omit audio for this first
// production cut: many camera audio codecs are not WebRTC-friendly, and bad
// audio should not block live viewing.
export function buildSrtPublishArgs(sourceRtspUrl, outputSrtUrl) {
  return [
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    '-rtsp_transport', 'tcp',
    '-i', sourceRtspUrl,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=1280:-2',
    '-r', '15',
    '-g', '30',
    '-keyint_min', '30',
    '-sc_threshold', '0',
    '-b:v', '1200k',
    '-maxrate', '1200k',
    '-bufsize', '1200k',
    '-f', 'mpegts',
    outputSrtUrl,
  ]
}
