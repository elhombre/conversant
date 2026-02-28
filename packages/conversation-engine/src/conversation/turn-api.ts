import type {
  ChatErrorPayload,
  ChatHistoryMessage,
  ChatRequestBody,
  ChatSuccessPayload,
  SessionResetRequestBody,
  SttErrorPayload,
  SttMeta,
  SttSuccessPayload,
  TtsErrorPayload,
  TtsRequestBody,
} from '@conversant/api-contracts'

import type { PendingUtteranceMeta, PersonaId, SttLanguageCode, SttLanguageMode, VoiceId } from './engine-types'

type ApiSuccess<TPayload> = {
  ok: true
  elapsedMs: number
  payload: TPayload | null
}

type ApiFailure<TErrorPayload> = {
  ok: false
  status: number
  elapsedMs: number
  errorPayload: TErrorPayload | null
}

type TtsSuccess = {
  ok: true
  blob: Blob
  elapsedMs: number
  responseTurnId: string | null
  latencyHeaderMs: number | null
}

type TtsFailure = {
  ok: false
  status: number
  elapsedMs: number
  errorPayload: TtsErrorPayload | null
}

async function parseJsonObject<TPayload>(response: Response): Promise<TPayload | null> {
  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false
  if (!isJson) {
    return null
  }

  try {
    const payload: unknown = await response.json()
    return payload && typeof payload === 'object' ? (payload as TPayload) : null
  } catch {
    return null
  }
}

export async function requestChatTurn({
  conversationId,
  turnId,
  transcript,
  personaId,
  history,
  signal,
}: {
  conversationId: string
  turnId: string
  transcript: string
  personaId: PersonaId
  history: ChatHistoryMessage[]
  signal: AbortSignal
}): Promise<ApiSuccess<ChatSuccessPayload> | ApiFailure<ChatErrorPayload>> {
  const body: ChatRequestBody = {
    conversationId,
    turnId,
    text: transcript,
    personaId,
    ...(history.length > 0 ? { history } : {}),
  }

  const startedAt = performance.now()
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
  const elapsedMs = Math.round(performance.now() - startedAt)

  if (!response.ok) {
    const errorPayload = await parseJsonObject<ChatErrorPayload>(response)
    return {
      ok: false,
      status: response.status,
      elapsedMs,
      errorPayload,
    }
  }

  const payload = await parseJsonObject<ChatSuccessPayload>(response)
  return {
    ok: true,
    elapsedMs,
    payload,
  }
}

export async function requestSttTurn({
  turnId,
  pending,
  blob,
  sttLanguageMode,
  allowedLanguages,
  signal,
}: {
  turnId: string
  pending: PendingUtteranceMeta
  blob: Blob
  sttLanguageMode: SttLanguageMode
  allowedLanguages: SttLanguageCode[]
  signal: AbortSignal
}): Promise<ApiSuccess<SttSuccessPayload> | ApiFailure<SttErrorPayload>> {
  const formData = new FormData()
  const fileName = `utterance-${turnId}.webm`
  const fileType = blob.type.length > 0 ? blob.type : 'audio/webm'
  const audioFile = new File([blob], fileName, { type: fileType })

  const meta: SttMeta = {
    turnId,
    preset: pending.preset,
    durationMs: pending.durationMs,
    sttLanguageMode,
    allowedLanguages,
  }

  formData.append('audio', audioFile)
  formData.append('meta', JSON.stringify(meta))

  const startedAt = performance.now()
  const response = await fetch('/api/stt', {
    method: 'POST',
    body: formData,
    signal,
  })
  const elapsedMs = Math.round(performance.now() - startedAt)

  if (!response.ok) {
    const errorPayload = await parseJsonObject<SttErrorPayload>(response)
    return {
      ok: false,
      status: response.status,
      elapsedMs,
      errorPayload,
    }
  }

  const payload = await parseJsonObject<SttSuccessPayload>(response)
  return {
    ok: true,
    elapsedMs,
    payload,
  }
}

export async function requestTtsTurn({
  turnId,
  text,
  voice,
  signal,
}: {
  turnId: string
  text: string
  voice: VoiceId
  signal: AbortSignal
}): Promise<TtsSuccess | TtsFailure> {
  const body: TtsRequestBody = {
    turnId,
    text,
    voice,
  }

  const startedAt = performance.now()
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
  const elapsedMs = Math.round(performance.now() - startedAt)

  if (!response.ok) {
    const errorPayload = await parseJsonObject<TtsErrorPayload>(response)
    return {
      ok: false,
      status: response.status,
      elapsedMs,
      errorPayload,
    }
  }

  const blob = await response.blob()
  const responseTurnId = response.headers.get('x-turn-id')
  const latencyHeader = response.headers.get('x-tts-latency-ms')
  const latencyFromHeader =
    typeof latencyHeader === 'string' && latencyHeader.length > 0 ? Number.parseInt(latencyHeader, 10) : NaN

  return {
    ok: true,
    blob,
    elapsedMs,
    responseTurnId,
    latencyHeaderMs: Number.isFinite(latencyFromHeader) ? latencyFromHeader : null,
  }
}

export async function requestResetConversation(conversationId: string): Promise<void> {
  const body: SessionResetRequestBody = {
    conversationId,
  }

  try {
    await fetch('/api/session/reset', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    // no-op: local reset should not fail when server cleanup is unavailable
  }
}
