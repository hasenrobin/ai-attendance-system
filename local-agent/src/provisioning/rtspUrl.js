// Embeds optional credentials into an RTSP URL using the WHATWG URL parser
// (handles percent-encoding of special characters in user/pass for us).
// `rtsp://host:port/path` parses fine even though `rtsp` isn't a "special"
// scheme, as long as it has the `//` authority separator.
export function buildRtspUrl({ rtspUrl, username, password }) {
  if (!rtspUrl) return rtspUrl
  if (!username && !password) return rtspUrl

  try {
    const url = new URL(rtspUrl)
    if (username) url.username = username
    if (password) url.password = password
    return url.toString()
  } catch {
    return rtspUrl
  }
}

// Masks credentials in an RTSP URL so it's safe to log or return in errors.
export function redact(url) {
  if (!url) return url

  try {
    const parsed = new URL(url)
    if (parsed.username) parsed.username = '****'
    if (parsed.password) parsed.password = '****'
    return parsed.toString()
  } catch {
    return url
  }
}
