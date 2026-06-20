import { spawn }      from 'node:child_process'
import { existsSync } from 'node:fs'
import { FFPROBE_PATH, FFPROBE_TIMEOUT_MS } from './config.js'

export class ProbeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProbeError'
  }
}

// spawn() without a shell: Node.js calls CreateProcess() on Windows which
// handles paths with spaces internally — no cmd.exe, no quoting needed.
// exec()/execFile()+shell:true both route through cmd.exe and split the path
// at the first space, producing "'C:\Program' is not recognized".
// spawn() eliminates that class of error entirely.
function spawnProbe(cmd, args, { timeout, maxBuffer }) {
  return new Promise((resolve, reject) => {
    let stdout  = ''
    let stderr  = ''
    let bytes   = 0
    let settled = false

    const child = spawn(cmd, args, { windowsHide: true })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(Object.assign(new Error('ffprobe timed out'), { killed: true, stderr }))
    }, timeout)

    child.stdout.on('data', chunk => {
      bytes += chunk.length
      if (bytes > maxBuffer) {
        clearTimeout(timer)
        if (settled) return
        settled = true
        child.kill()
        reject(Object.assign(new Error('ffprobe output exceeded maxBuffer'), { code: 'ERR_BUFFER_OVERFLOW', stderr }))
        return
      }
      stdout += chunk
    })

    child.stderr.on('data', chunk => { stderr += chunk })

    child.on('error', err => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      err.stderr = stderr
      reject(err)
    })

    child.on('close', code => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(Object.assign(
          new Error(`ffprobe exited ${code}${stderr ? '\n' + stderr.slice(0, 300) : ''}`),
          { code, stdout, stderr },
        ))
      }
    })
  })
}

// Runs ffprobe against an RTSP URL (credentials already embedded) and
// reports the first video/audio stream's codec.
export async function probeStream(rtspUrlWithCreds) {
  console.log(`[ffprobe] path   : ${JSON.stringify(FFPROBE_PATH)}`)
  console.log(`[ffprobe] exists : ${existsSync(FFPROBE_PATH)}`)

  // The Node.js spawnProbe timeout (FFPROBE_TIMEOUT_MS = 10 s) kills the
  // process if it hangs. No -stimeout flag: it is a format-level private
  // option that some ffprobe builds do not expose at the command line.
  const args = [
    '-v', 'error',
    '-rtsp_transport', 'tcp',
    '-i', rtspUrlWithCreds,
    '-show_streams', '-of', 'json',
  ]

  let stdout
  try {
    const result = await spawnProbe(FFPROBE_PATH, args, {
      timeout:   FFPROBE_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    })
    stdout = result.stdout
    console.log('[ffprobe] completed successfully')
  } catch (err) {
    console.error(`[ffprobe] error code    : ${err.code ?? 'n/a'}`)
    console.error(`[ffprobe] error killed  : ${err.killed ?? false}`)
    console.error(`[ffprobe] error message : ${err.message}`)
    if (err.stderr) {
      const snip = String(err.stderr).slice(0, 400).replace(/\n/g, ' ')
      console.error(`[ffprobe] stderr snippet: ${snip}`)
    }

    if (err.killed) {
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
  const video   = streams.find(s => s.codec_type === 'video')
  const audio   = streams.find(s => s.codec_type === 'audio')

  const probe = {
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    hasVideo:   Boolean(video),
    hasAudio:   Boolean(audio),
  }
  console.log(`[ffprobe] result: videoCodec=${probe.videoCodec} audioCodec=${probe.audioCodec} hasVideo=${probe.hasVideo} hasAudio=${probe.hasAudio}`)
  return probe
}
