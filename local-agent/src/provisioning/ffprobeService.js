import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { FFPROBE_PATH, FFPROBE_TIMEOUT_MS } from './config.js'

const execFileAsync = promisify(execFile)

export class ProbeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProbeError'
  }
}

// Runs ffprobe against an RTSP URL (credentials already embedded) and
// reports the first video/audio stream's codec. This also doubles as the
// "is this RTSP URL/credentials valid and reachable" check.
export async function probeStream(rtspUrlWithCreds) {
  let stdout
  try {
    const result = await execFileAsync(
      FFPROBE_PATH,
      ['-rtsp_transport', 'tcp', '-i', rtspUrlWithCreds, '-show_streams', '-of', 'json'],
      { timeout: FFPROBE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
    )
    stdout = result.stdout
  } catch (err) {
    if (err.killed || err.signal) {
      throw new ProbeError('ffprobe timed out — camera unreachable or RTSP URL/credentials are incorrect')
    }
    throw new ProbeError('ffprobe could not read the stream — check the RTSP URL and credentials')
  }

  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new ProbeError('ffprobe returned unexpected output')
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : []
  const video = streams.find(s => s.codec_type === 'video')
  const audio = streams.find(s => s.codec_type === 'audio')

  return {
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
  }
}
