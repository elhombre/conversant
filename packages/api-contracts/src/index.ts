export const PERSONA_IDS = ['Concise', 'Conversational', 'Interviewer'] as const
export type PersonaId = (typeof PERSONA_IDS)[number]

export const VOICE_IDS = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const
export type VoiceId = (typeof VOICE_IDS)[number]

export const STT_LANGUAGE_CODES = ['en', 'ru', 'es', 'de', 'fr', 'it', 'pt', 'tr', 'uk', 'pl'] as const
export type SttLanguageCode = (typeof STT_LANGUAGE_CODES)[number]

export const STT_LANGUAGE_MODES = ['off', 'strict'] as const
export type SttLanguageMode = (typeof STT_LANGUAGE_MODES)[number]

export type ChatErrorCode = 'BadRequest' | 'Timeout' | 'Cancelled' | 'ProviderUnavailable' | 'InternalError'

export type SttErrorCode =
  | 'BadAudioFormat'
  | 'PayloadTooLarge'
  | 'UnsupportedLanguage'
  | 'NoSpeechDetected'
  | 'Timeout'
  | 'Cancelled'
  | 'ProviderUnavailable'
  | 'InternalError'

export type TtsErrorCode = 'BadRequest' | 'Timeout' | 'Cancelled' | 'ProviderUnavailable' | 'InternalError'

type ErrorEnvelope<Code extends string> = {
  turnId?: string | null
  error?: {
    code?: Code | string
    message?: string
  }
}

export type ChatHistoryMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ChatRequestBody = {
  conversationId: string
  turnId: string
  text: string
  personaId?: PersonaId
  history?: ChatHistoryMessage[]
}

export type ChatSuccessPayload = {
  conversationId: string
  turnId: string
  text: string
  personaId?: PersonaId
  latencyMs?: number
}

export type ChatErrorPayload = ErrorEnvelope<ChatErrorCode>

export type SttMeta = {
  turnId: string
  preset?: string
  durationMs?: number
  sttLanguageMode?: SttLanguageMode
  allowedLanguages?: SttLanguageCode[]
}

export type SttSuccessPayload = {
  turnId: string
  text: string
  detectedLanguage?: SttLanguageCode | null
  latencyMs?: number
}

export type SttErrorPayload = ErrorEnvelope<SttErrorCode>

export type TtsRequestBody = {
  turnId: string
  text: string
  voice: VoiceId
}

export type TtsErrorPayload = ErrorEnvelope<TtsErrorCode>

export type SessionResetRequestBody = {
  conversationId: string
}

export type SessionResetSuccessPayload = {
  conversationId: string
  cleared: true
}
