import { STT_LANGUAGE_CODES, type SttLanguageCode, type SttMeta } from '@conversant/api-contracts'
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

const MAX_AUDIO_BYTES = 8 * 1024 * 1024
const STT_TIMEOUT_MS = 12_000

const SUPPORTED_STT_LANGUAGES = new Set<string>(STT_LANGUAGE_CODES)

const LANGUAGE_ALIASES: Record<string, SttLanguageCode> = {
  english: 'en',
  russian: 'ru',
  spanish: 'es',
  german: 'de',
  french: 'fr',
  italian: 'it',
  portuguese: 'pt',
  turkish: 'tr',
  ukrainian: 'uk',
  polish: 'pl',
}

function isSttLanguageCode(value: string): value is SttLanguageCode {
  return SUPPORTED_STT_LANGUAGES.has(value)
}

function normalizeLanguage(value: string): SttLanguageCode | null {
  const raw = value.trim().toLowerCase()
  if (raw.length === 0) {
    return null
  }

  if (raw in LANGUAGE_ALIASES) {
    return LANGUAGE_ALIASES[raw]
  }

  if (isSttLanguageCode(raw)) {
    return raw
  }

  const bcp47Code = raw.split(/[-_]/)[0]
  if (isSttLanguageCode(bcp47Code)) {
    return bcp47Code
  }

  return null
}

function readDetectedLanguage(payload: unknown): SttLanguageCode | null {
  const data = asRecord(payload)
  if (!data) {
    return null
  }

  return normalizeLanguage(typeof data.language === 'string' ? data.language : '')
}

function parseMeta(rawMeta: FormDataEntryValue | null): SttMeta | null {
  if (typeof rawMeta !== 'string') {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawMeta)
  } catch {
    return null
  }

  const data = asRecord(parsed)
  if (!data) {
    return null
  }

  const turnId = readNonEmptyString(data.turnId)
  if (!turnId) {
    return null
  }

  const preset = readNonEmptyString(data.preset) ?? undefined
  const durationMs =
    typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) ? data.durationMs : undefined

  const sttLanguageModeRaw = readNonEmptyString(data.sttLanguageMode)
  const sttLanguageMode =
    sttLanguageModeRaw === 'off' || sttLanguageModeRaw === 'strict' ? sttLanguageModeRaw : undefined

  const allowedLanguages = Array.isArray(data.allowedLanguages)
    ? [
        ...new Set(
          data.allowedLanguages
            .filter((value): value is string => typeof value === 'string')
            .map(value => normalizeLanguage(value))
            .filter((value): value is SttLanguageCode => value !== null),
        ),
      ]
    : undefined

  return {
    turnId,
    preset,
    durationMs,
    sttLanguageMode,
    allowedLanguages,
  }
}

function mapProviderError(status: number | null, message: string) {
  const normalized = message.toLowerCase()

  if (isLikelyProviderNetworkError(status, message, ['404 page not found'])) {
    return {
      status: 500,
      code: 'ProviderUnavailable' as const,
    }
  }

  if (status === 400) {
    if (
      normalized.includes('no speech') ||
      normalized.includes('empty transcript') ||
      normalized.includes('did not detect')
    ) {
      return {
        status: 422,
        code: 'NoSpeechDetected' as const,
      }
    }

    return {
      status: 400,
      code: 'BadAudioFormat' as const,
    }
  }

  if (isProviderUnavailableStatus(status)) {
    return {
      status: 500,
      code: 'ProviderUnavailable' as const,
    }
  }

  if (isTimeoutStatus(status)) {
    return {
      status: 504,
      code: 'Timeout' as const,
    }
  }

  return {
    status: 500,
    code: 'InternalError' as const,
  }
}

export async function handleSttPost(request: Request) {
  const providerConfig = readOpenAIProviderEnv()
  if (!providerConfig) {
    return jsonError(500, null, 'ProviderUnavailable', 'OPENAI_API_KEY is not configured')
  }

  const formData = await request.formData()
  const audio = formData.get('audio')
  const meta = parseMeta(formData.get('meta'))

  if (!(audio instanceof File) || !meta) {
    return jsonError(400, meta?.turnId ?? null, 'BadAudioFormat', 'Invalid STT payload')
  }

  const sttLanguageMode = meta.sttLanguageMode ?? 'off'
  const allowedLanguages = meta.allowedLanguages?.filter(language => SUPPORTED_STT_LANGUAGES.has(language)) ?? []

  if (sttLanguageMode === 'strict' && allowedLanguages.length === 0) {
    return jsonError(400, meta.turnId, 'UnsupportedLanguage', 'No supported languages were selected for STT filter')
  }

  if (audio.size === 0) {
    return jsonError(400, meta.turnId, 'BadAudioFormat', 'Audio file is empty')
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return jsonError(413, meta.turnId, 'PayloadTooLarge', 'Audio payload exceeds 8 MB')
  }

  const signal = createRequestSignal(request.signal, STT_TIMEOUT_MS)
  const modelConfig = readOpenAIModelEnv()
  const sttModel = modelConfig.sttModel
  const sttLanguageDetectModel = modelConfig.sttLanguageDetectModel
  const client = createOpenAIClient(providerConfig)
  const startedAt = performance.now()

  try {
    const isStrictMultiLanguage = sttLanguageMode === 'strict' && allowedLanguages.length > 1
    let detectedLanguage: SttLanguageCode | null = null

    if (isStrictMultiLanguage) {
      let detectionResult: unknown
      try {
        detectionResult = await client.audio.transcriptions.create(
          {
            file: audio,
            model: sttLanguageDetectModel,
            response_format: 'verbose_json',
          },
          {
            signal,
          },
        )
      } catch {
        return jsonError(
          500,
          meta.turnId,
          'ProviderUnavailable',
          'Strict multi-language filter requires detectable language. Switch to one language or disable filter.',
        )
      }

      detectedLanguage = readDetectedLanguage(detectionResult)
      if (!detectedLanguage) {
        return jsonError(
          500,
          meta.turnId,
          'InternalError',
          'Could not detect language for strict multi-language filter',
        )
      }

      if (!allowedLanguages.includes(detectedLanguage)) {
        return jsonError(
          400,
          meta.turnId,
          'UnsupportedLanguage',
          `Detected language "${detectedLanguage}" is outside allowed set`,
        )
      }
    }

    const requestPayload: {
      file: File
      model: string
      language?: string
    } = {
      file: audio,
      model: sttModel,
    }

    if (sttLanguageMode === 'strict') {
      if (allowedLanguages.length === 1) {
        requestPayload.language = allowedLanguages[0]
      } else if (detectedLanguage) {
        requestPayload.language = detectedLanguage
      }
    }

    const result = await client.audio.transcriptions.create(requestPayload, {
      signal,
    })

    const text = result.text.trim()
    if (!text) {
      return jsonError(422, meta.turnId, 'NoSpeechDetected', 'No speech detected in utterance')
    }

    const detectedLanguageFromMain = readDetectedLanguage(result)
    const finalDetectedLanguage =
      sttLanguageMode === 'strict' && allowedLanguages.length === 1
        ? allowedLanguages[0]
        : (detectedLanguage ?? detectedLanguageFromMain)

    return Response.json(
      {
        turnId: meta.turnId,
        text,
        detectedLanguage: finalDetectedLanguage,
        latencyMs: Math.round(performance.now() - startedAt),
      },
      {
        headers: {
          'cache-control': 'no-store',
        },
      },
    )
  } catch (error) {
    const abortKind = getAbortKind(signal, request.signal)
    if (abortKind === 'cancelled') {
      return jsonError(499, meta.turnId, 'Cancelled', 'STT request was cancelled')
    }

    if (abortKind === 'timeout') {
      return jsonError(504, meta.turnId, 'Timeout', 'STT request timed out')
    }

    const status = getProviderErrorStatus(error)
    const message = getProviderErrorMessage(error, 'Unknown STT provider error')
    const mapped = mapProviderError(status, message)

    const normalized = message.toLowerCase()
    const mappedMessage =
      mapped.code === 'ProviderUnavailable' && (normalized.includes('not found') || normalized.includes('404'))
        ? 'Configured provider does not support /audio/transcriptions. Use an OpenAI-compatible STT endpoint.'
        : mapped.code === 'ProviderUnavailable'
          ? 'Cannot reach STT provider. Check OPENAI_BASE_URL and provider availability.'
          : message

    return jsonError(mapped.status, meta.turnId, mapped.code, mappedMessage)
  }
}
