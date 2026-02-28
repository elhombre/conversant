import {
  type PersonaId as ApiPersonaId,
  type SttLanguageCode as ApiSttLanguageCode,
  type SttLanguageMode as ApiSttLanguageMode,
  type VoiceId as ApiVoiceId,
  PERSONA_IDS,
  STT_LANGUAGE_CODES,
  VOICE_IDS,
} from '@conversant/api-contracts'

import type { VadEndReason, VadPreset } from '../vad/types'

export type ConversationState = 'listening' | 'user_speaking' | 'processing' | 'assistant_speaking' | 'error'
export type MicStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'error'
export type CaptureStage = 'idle' | 'speaking' | 'finalizing'
export type AudioCtxState = AudioContextState | 'uninitialized'

export type PersonaId = ApiPersonaId
export type VoiceId = ApiVoiceId
export type SttLanguageCode = ApiSttLanguageCode
export type SttLanguageMode = ApiSttLanguageMode

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

export type LastCompletedTurn = {
  turnId: string
  transcript: string
  assistantText: string
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

export const PERSONA_ORDER: PersonaId[] = [...PERSONA_IDS]
export const VOICE_ORDER: VoiceId[] = [...VOICE_IDS]
export const STT_LANGUAGE_ORDER: SttLanguageCode[] = [...STT_LANGUAGE_CODES]
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
