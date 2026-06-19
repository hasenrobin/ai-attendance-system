// Vendor URL templates for NVR/DVR channels. Placeholders {host} {port}
// {username} {password} {channel} are resolved by resolveChannelTemplate
// using the parent NVR's connection details + the channel number.
export const NVR_VENDOR_TEMPLATES = {
  hikvision: 'rtsp://{username}:{password}@{host}:{port}/Streaming/Channels/{channel}01',
  dahua: 'rtsp://{username}:{password}@{host}:{port}/cam/realmonitor?channel={channel}&subtype=0',
  generic: '',
}

// A channel value is treated as a template (rather than a literal RTSP URL)
// if it contains a `{placeholder}`. Camera passwords essentially never
// contain literal braces, so this heuristic is safe in practice.
export function isChannelTemplate(value) {
  return typeof value === 'string' && value.includes('{')
}

export function resolveChannelTemplate(template, { host, port, username, password, channel }) {
  return template
    .replaceAll('{host}', host ?? '')
    .replaceAll('{port}', port != null ? String(port) : '')
    .replaceAll('{username}', encodeURIComponent(username ?? ''))
    .replaceAll('{password}', encodeURIComponent(password ?? ''))
    .replaceAll('{channel}', channel ?? '')
}

// channelValue is either a literal rtsp:// URL (passed through unchanged) or
// a template containing {placeholders} resolved against the parent NVR's
// host/port/credentials and this channel's number.
export function resolveChannelRtspUrl(channelValue, parentInfo) {
  if (!isChannelTemplate(channelValue)) return channelValue
  return resolveChannelTemplate(channelValue, parentInfo)
}
