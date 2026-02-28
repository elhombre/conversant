import { type TtsRequestBody, VOICE_IDS, type VoiceId } from '@conversant/api-contracts'
import { readOpenAIModelEnv, readOpenAIProviderEnv } from '@conversant/config'

import { createRequestSignal, getAbortKind } from './shared/abort'
import { jsonError } from './shared/http'
import { createOpenAIClient } from './shared/openai-client'
import {
  getProviderErrorMessage,
  getProviderErrorStatus,
  isLikelyProviderNetworkError,
  isProviderUnavailableStatus,
  isTimeoutStatus,
} from './shared/openai-error'
import { asRecord, readNonEmptyString } from './shared/parsing'

const TTS_TIMEOUT_MS = 15_000
const MAX_TTS_TEXT_CHARS = 4_000

const SUPPORTED_VOICES: ReadonlySet<string> = new Set(VOICE_IDS)

function isVoiceId(value: string): value is VoiceId {
  return SUPPORTED_VOICES.has(value)
}

function parseBody(rawBody: unknown): TtsRequestBody | null {
  const body = asRecord(rawBody)
  if (!body) {
    return null
  }

  const turnId = readNonEmptyString(body.turnId)
  const text = readNonEmptyString(body.text)
  const voiceRaw = readNonEmptyString(body.voice)
  if (!turnId || !text || !voiceRaw) {
    return null
  }

  if (text.length > MAX_TTS_TEXT_CHARS || !isVoiceId(voiceRaw)) {
    return null
  }

  return {
    turnId,
    text,
    voice: voiceRaw,
  }
}

function mapProviderError(status: number | null, message: string) {
  if (isLikelyProviderNetworkError(status, message)) {
    return {
      status: 500,
      code: 'ProviderUnavailable' as const,
      message: 'Cannot reach TTS provider. Check OPENAI_BASE_URL and model availability.',
    }
  }

  if (status === 400) {
    return {
      status: 400,
      code: 'BadRequest' as const,
      message,
    }
  }

  if (isTimeoutStatus(status)) {
    return {
      status: 504,
      code: 'Timeout' as const,
      message: 'TTS request timed out',
    }
  }

  if (isProviderUnavailableStatus(status)) {
    return {
      status: 500,
      code: 'ProviderUnavailable' as const,
      message,
    }
  }

  return {
    status: 500,
    code: 'InternalError' as const,
    message,
  }
}

export async function handleTtsPost(request: Request) {
  const providerConfig = readOpenAIProviderEnv()
  if (!providerConfig) {
    return jsonError(500, null, 'ProviderUnavailable', 'OPENAI_API_KEY is not configured')
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return jsonError(400, null, 'BadRequest', 'Invalid JSON payload')
  }

  const body = parseBody(rawBody)
  if (!body) {
    return jsonError(400, null, 'BadRequest', 'Invalid TTS payload')
  }

  const signal = createRequestSignal(request.signal, TTS_TIMEOUT_MS)
  const modelConfig = readOpenAIModelEnv()
  const ttsModel = modelConfig.ttsModel
  const client = createOpenAIClient(providerConfig)
  const startedAt = performance.now()

  try {
    const speech = await client.audio.speech.create(
      {
        model: ttsModel,
        voice: body.voice,
        input: body.text,
        response_format: 'mp3',
      },
      { signal },
    )

    const audioBytes = Buffer.from(await speech.arrayBuffer())
    if (audioBytes.byteLength === 0) {
      return jsonError(500, body.turnId, 'InternalError', 'TTS provider returned empty audio')
    }

    return new Response(audioBytes, {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'audio/mpeg',
        'x-turn-id': body.turnId,
        'x-tts-latency-ms': String(Math.round(performance.now() - startedAt)),
      },
    })
  } catch (error) {
    const abortKind = getAbortKind(signal, request.signal)
    if (abortKind === 'cancelled') {
      return jsonError(499, body.turnId, 'Cancelled', 'TTS request was cancelled')
    }

    if (abortKind === 'timeout') {
      return jsonError(504, body.turnId, 'Timeout', 'TTS request timed out')
    }

    const status = getProviderErrorStatus(error)
    const message = getProviderErrorMessage(error, 'Unknown TTS provider error')
    const mapped = mapProviderError(status, message)

    return jsonError(mapped.status, body.turnId, mapped.code, mapped.message)
  }
}
