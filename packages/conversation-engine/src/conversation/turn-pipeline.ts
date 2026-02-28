import type {
  ChatErrorCode,
  ChatErrorPayload,
  SttErrorCode,
  SttErrorPayload,
  TtsErrorCode,
  TtsErrorPayload,
} from '@conversant/api-contracts'

export const TOTAL_TURN_SOFT_TIMEOUT_MS = 30_000
export const STT_REQUEST_TIMEOUT_MS = 12_000
export const CHAT_REQUEST_TIMEOUT_MS = 15_000
export const TTS_REQUEST_TIMEOUT_MS = 15_000

export function getSttErrorMessage(status: number, payload: SttErrorPayload | null) {
  const defaultMessages: Record<SttErrorCode, string> = {
    BadAudioFormat: 'Invalid audio format or payload.',
    PayloadTooLarge: 'Audio payload is too large.',
    UnsupportedLanguage: 'Detected language is outside the selected language set.',
    NoSpeechDetected: 'No speech detected. Try speaking a bit longer.',
    Timeout: 'STT request timed out. Please retry.',
    Cancelled: 'STT request was cancelled.',
    ProviderUnavailable: 'STT provider is unavailable right now.',
    InternalError: 'Unexpected STT error occurred.',
  }

  const code = payload?.error?.code
  const message = payload?.error?.message

  if (typeof message === 'string' && message.length > 0) {
    return message
  }

  if (typeof code === 'string' && code in defaultMessages) {
    return defaultMessages[code as SttErrorCode]
  }

  if (status >= 500) {
    return defaultMessages.ProviderUnavailable
  }

  if (status === 422) {
    return defaultMessages.NoSpeechDetected
  }

  return defaultMessages.InternalError
}

export function isNoSpeechDetectedStt(status: number, payload: SttErrorPayload | null) {
  const code = payload?.error?.code
  if (code === 'NoSpeechDetected') {
    return true
  }

  if (status !== 422) {
    return false
  }

  const message = payload?.error?.message
  if (typeof message !== 'string' || message.length === 0) {
    return true
  }

  const normalizedMessage = message.toLowerCase()
  return (
    normalizedMessage.includes('no speech') ||
    normalizedMessage.includes('empty transcript') ||
    normalizedMessage.includes('did not detect')
  )
}

export function getChatErrorMessage(status: number, payload: ChatErrorPayload | null) {
  const defaultMessages: Record<ChatErrorCode, string> = {
    BadRequest: 'Invalid chat payload.',
    Timeout: 'LLM request timed out. Please retry.',
    Cancelled: 'Chat request was cancelled.',
    ProviderUnavailable: 'LLM provider is unavailable right now.',
    InternalError: 'Unexpected LLM error occurred.',
  }

  const code = payload?.error?.code
  const message = payload?.error?.message

  if (typeof message === 'string' && message.length > 0) {
    return message
  }

  if (typeof code === 'string' && code in defaultMessages) {
    return defaultMessages[code as ChatErrorCode]
  }

  if (status >= 500) {
    return defaultMessages.ProviderUnavailable
  }

  return defaultMessages.InternalError
}

export function getTtsErrorMessage(status: number, payload: TtsErrorPayload | null) {
  const defaultMessages: Record<TtsErrorCode, string> = {
    BadRequest: 'Invalid TTS payload.',
    Timeout: 'TTS request timed out. Please retry.',
    Cancelled: 'TTS request was cancelled.',
    ProviderUnavailable: 'TTS provider is unavailable right now.',
    InternalError: 'Unexpected TTS error occurred.',
  }

  const code = payload?.error?.code
  const message = payload?.error?.message

  if (typeof message === 'string' && message.length > 0) {
    return message
  }

  if (typeof code === 'string' && code in defaultMessages) {
    return defaultMessages[code as TtsErrorCode]
  }

  if (status >= 500) {
    return defaultMessages.ProviderUnavailable
  }

  return defaultMessages.InternalError
}
