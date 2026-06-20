import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
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
  // Diagnostics logged before every ffprobe attempt.
  console.log(`[ffprobe] path   : ${JSON.stringify(FFPROBE_PATH)}`)
  console.log(`[ffprobe] exists : ${existsSync(FFPROBE_PATH)}`)

  const args = ['-rtsp_transport', 'tcp', '-i', rtspUrlWithCreds, '-show_streams', '-of', 'json']

  let stdout
  try {
    // On Windows, execFile with a path that contains spaces (e.g. C:\Program Files\...)
    // can fail with ENOENT even when the file exists. shell: true routes through cmd.exe
    // which handles quoted paths reliably — same fix as the MediaMTX spawn issue.
    const result = await execFileAsync(
      FFPROBE_PATH,
      args,
      {
        timeout: FFPROBE_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        shell: process.platform === 'win32',
      },
    )
    stdout = result.stdout
    console.log(`[ffprobe] completed successfully`)
  } catch (err) {
    // Log the raw error so it appears in agent.log for diagnostics.
    console.error(`[ffprobe] error code    : ${err.code ?? 'n/a'}`)
    console.error(`[ffprobe] error signal  : ${err.signal ?? 'none'}`)
    console.error(`[ffprobe] error killed  : ${err.killed ?? false}`)
    console.error(`[ffprobe] error message : ${err.message}`)
    if (err.stderr) {
      const stderrSnip = String(err.stderr).slice(0, 400).replace(/\n/g, ' ')
      console.error(`[ffprobe] stderr snippet: ${stderrSnip}`)
    }

    if (err.killed || err.signal || err.code === 'ETIMEDOUT') {
      throw new ProbeError('ffprobe timed out — camera unreachable or RTSP URL/credentials are incorrect')
    }
    if (err.code === 'ENOENT') {
      throw new ProbeError(`ffprobe binary not found at: ${FFPROBE_PATH}`)
    }
    throw new ProbeError(`ffprobe failed (${err.code ?? 'unknown'}): ${err.message}`)
  }

  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new ProbeError('ffprobe returned unexpected output (not valid JSON)')
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : []
  const video = streams.find(s => s.codec_type === 'video')
  const audio = streams.find(s => s.codec_type === 'audio')

  const probe = {
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
  }
  console.log(`[ffprobe] result: videoCodec=${probe.videoCodec} audioCodec=${probe.audioCodec} hasVideo=${probe.hasVideo} hasAudio=${probe.hasAudio}`)
  return probe
}
