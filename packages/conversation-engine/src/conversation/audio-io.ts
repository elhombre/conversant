export const PRE_TRIGGER_DB_MARGIN = 10
export const MAX_TENTATIVE_CAPTURE_MS = 1_200
export const BARGE_IN_MIC_BOOST_DB = 2
export const BARGE_IN_PLAYBACK_DELTA_DB = -6
export const BARGE_IN_ECHO_SUPPRESS_DB = 10
export const BARGE_IN_HOLD_MS = 90

export function pickRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return null

  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType
    }
  }

  return ''
}

export function createTurnId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `turn-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`
}

export function calculateDbFromTimeDomain(buffer: Uint8Array<ArrayBuffer>): number {
  let sumSquares = 0
  for (let i = 0; i < buffer.length; i += 1) {
    const value = (buffer[i] - 128) / 128
    sumSquares += value * value
  }

  const rms = Math.sqrt(sumSquares / buffer.length)
  return rms > 0 ? 20 * Math.log10(rms) : -100
}
