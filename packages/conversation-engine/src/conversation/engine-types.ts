import type { VadEndReason, VadPreset } from '../vad/types'

export type ConversationState = 'listening' | 'user_speaking' | 'processing' | 'assistant_speaking' | 'error'
export type MicStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'error'
export type CaptureStage = 'idle' | 'speaking' | 'finalizing'
export type AudioCtxState = AudioContextState | 'uninitialized'

export type PersonaId = 'Concise' | 'Conversational' | 'Interviewer'
export type VoiceId = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'
export type SttLanguageCode = 'en' | 'ru' | 'es' | 'de' | 'fr' | 'it' | 'pt' | 'tr' | 'uk' | 'pl'
export type SttLanguageMode = 'off' | 'strict'

export type LastUtterance = {
  turnId: string
  url: string
  mimeType: string
  durationMs: number
  sizeBytes: number
  reason: VadEndReason
  createdAtMs: number
  preset: VadPreset
}

export type PendingUtteranceMeta = {
  token: number
  sessionToken: number
  turnId: string
  preset: VadPreset
  startMs: number
  endMs: number
  durationMs: number
  reason: VadEndReason
  accepted: boolean
  confirmed: boolean
  silentDiscard: boolean
}

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

export const PERSONA_ORDER: PersonaId[] = ['Concise', 'Conversational', 'Interviewer']
export const VOICE_ORDER: VoiceId[] = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
export const STT_LANGUAGE_ORDER: SttLanguageCode[] = ['en', 'ru', 'es', 'de', 'fr', 'it', 'pt', 'tr', 'uk', 'pl']
export const STT_LANGUAGE_LABELS: Record<SttLanguageCode, string> = {
  en: 'English',
  ru: 'Russian',
  es: 'Spanish',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  pt: 'Portuguese',
  tr: 'Turkish',
  uk: 'Ukrainian',
  pl: 'Polish',
}
