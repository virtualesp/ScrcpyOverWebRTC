export const defaultSettings = {
  fps: 0,
  size: 0,
  bitrate: 4,
  bwe: true,
  minBitrate: 8,
  maxBitrate: 20,
  audio: false,
  audioGain: 1,
  audioSource: 'playback',
  audioDup: true,
  audioLowLatency: false,
  pageAudioMuted: false,
  debug: false
}

function parseSettings(parsed) {
  const hasAudioDup = Object.prototype.hasOwnProperty.call(parsed, 'audioDup')
  if (parsed.bitrate > 1000) {
    parsed.bitrate = Math.max(1, Math.round(parsed.bitrate / 1000000))
    if (parsed.minBitrate > 1000) parsed.minBitrate = Math.max(1, Math.round(parsed.minBitrate / 1000000))
    if (parsed.maxBitrate > 1000) parsed.maxBitrate = Math.max(1, Math.round(parsed.maxBitrate / 1000000))
  }
  if (parsed.audioGain === undefined) parsed.audioGain = defaultSettings.audioGain
  if (parsed.audioSource === undefined) parsed.audioSource = defaultSettings.audioSource
  if (!hasAudioDup && parsed.audioSource === 'output') parsed.audioSource = defaultSettings.audioSource
  if (parsed.audioDup === undefined) parsed.audioDup = defaultSettings.audioDup
  if (parsed.pageAudioMuted === undefined) parsed.pageAudioMuted = defaultSettings.pageAudioMuted
  return parsed
}

export function getDeviceSettings(deviceId) {
  let globalSettings = { ...defaultSettings }
  try {
    const storedGlobal = localStorage.getItem('cloudphone_settings')
    if (storedGlobal) {
      globalSettings = { ...globalSettings, ...parseSettings(JSON.parse(storedGlobal)) }
      localStorage.setItem('cloudphone_settings', JSON.stringify(globalSettings))
    }
  } catch(e) {}

  if (!deviceId) return globalSettings

  try {
    const storedDev = localStorage.getItem(`cloudphone_settings_${deviceId}`)
    if (storedDev) {
      const devSettings = { ...globalSettings, ...parseSettings(JSON.parse(storedDev)) }
      localStorage.setItem(`cloudphone_settings_${deviceId}`, JSON.stringify(devSettings))
      return devSettings
    }
  } catch(e) {}
  
  return globalSettings
}

export function saveDeviceSettings(deviceId, newSettings) {
  if (!deviceId) {
    localStorage.setItem('cloudphone_settings', JSON.stringify(newSettings))
  } else {
    localStorage.setItem(`cloudphone_settings_${deviceId}`, JSON.stringify(newSettings))
  }
}

export function hasCustomSettings(deviceId) {
  if (!deviceId) return false
  return localStorage.getItem(`cloudphone_settings_${deviceId}`) !== null
}

export function deleteDeviceSettings(deviceId) {
  if (deviceId) {
    localStorage.removeItem(`cloudphone_settings_${deviceId}`)
  }
}
