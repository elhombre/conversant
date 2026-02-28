import OpenAI from 'openai'

const MAX_AUDIO_BYTES = 8 * 1024 * 1024
const STT_TIMEOUT_MS = 12_000

type SttMeta = {
  turnId: string
  preset?: string
  durationMs?: number
  sttLanguageMode?: 'off' | 'strict'
  allowedLanguages?: string[]
}

type SttErrorCode =
  | 'BadAudioFormat'
  | 'PayloadTooLarge'
  | 'UnsupportedLanguage'
  | 'NoSpeechDetected'
  | 'Timeout'
  | 'Cancelled'
  | 'ProviderUnavailable'
  | 'InternalError'

const SUPPORTED_STT_LANGUAGES = new Set(['en', 'ru', 'es', 'de', 'fr', 'it', 'pt', 'tr', 'uk', 'pl'])

const LANGUAGE_ALIASES: Record<string, string> = {
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

function normalizeLanguage(value: string): string | null {
  const raw = value.trim().toLowerCase()
  if (raw.length === 0) {
    return null
  }

  if (raw in LANGUAGE_ALIASES) {
    return LANGUAGE_ALIASES[raw]
  }

  if (SUPPORTED_STT_LANGUAGES.has(raw)) {
    return raw
  }

  const bcp47Code = raw.split(/[-_]/)[0]
  if (SUPPORTED_STT_LANGUAGES.has(bcp47Code)) {
    return bcp47Code
  }

  return null
}

function readDetectedLanguage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const rawLanguage = (payload as { language?: unknown }).language
  if (typeof rawLanguage !== 'string') {
    return null
  }

  return normalizeLanguage(rawLanguage)
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function parseMeta(rawMeta: FormDataEntryValue | null): SttMeta | null {
  if (typeof rawMeta !== 'string') {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(rawMeta)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const turnId = getString((parsed as { turnId?: unknown }).turnId)
    if (!turnId) {
      return null
    }

    const preset = getString((parsed as { preset?: unknown }).preset) ?? undefined
    const durationMsRaw = (parsed as { durationMs?: unknown }).durationMs
    const durationMs = typeof durationMsRaw === 'number' && Number.isFinite(durationMsRaw) ? durationMsRaw : undefined

    const sttLanguageModeRaw = getString((parsed as { sttLanguageMode?: unknown }).sttLanguageMode)
    const sttLanguageMode =
      sttLanguageModeRaw === 'off' || sttLanguageModeRaw === 'strict' ? sttLanguageModeRaw : undefined

    const allowedLanguagesRaw = (parsed as { allowedLanguages?: unknown }).allowedLanguages
    const allowedLanguages = Array.isArray(allowedLanguagesRaw)
      ? [
          ...new Set(
            allowedLanguagesRaw
              .filter(value => typeof value === 'string')
              .map(value => normalizeLanguage(value))
              .filter((value): value is string => value !== null),
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
  } catch {
    return null
  }
}

function jsonError(status: number, turnId: string | null, code: SttErrorCode, message: string) {
  return Response.json(
    {
      turnId,
      error: {
        code,
        message,
      },
    },
    { status },
  )
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const candidate = (error as { status?: unknown }).status
  return typeof candidate === 'number' ? candidate : null
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message
  }

  return 'Unknown STT provider error'
}

function createCombinedSignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }
  }

  const abort = (event: Event) => {
    const target = event.target
    if (target instanceof AbortSignal) {
      controller.abort(target.reason)
      return
    }

    controller.abort('aborted')
  }

  for (const signal of signals) {
    signal.addEventListener('abort', abort, { once: true })
  }

  return controller.signal
}

function mapProviderError(status: number | null, message: string) {
  const normalized = message.toLowerCase()

  if (
    status === 404 ||
    normalized.includes('404 page not found') ||
    normalized.includes('not found') ||
    normalized.includes('connection error') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('econnrefused') ||
    normalized.includes('enotfound') ||
    normalized.includes('network')
  ) {
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

  if (status === 401 || status === 403 || status === 429 || (status !== null && status >= 500)) {
    return {
      status: 500,
      code: 'ProviderUnavailable' as const,
    }
  }

  if (status === 408 || status === 504) {
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

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const providerApiKey = process.env.OPENAI_API_KEY
  const providerBaseUrl = process.env.OPENAI_BASE_URL?.trim()
  if (!providerApiKey) {
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

  const timeoutSignal = AbortSignal.timeout(STT_TIMEOUT_MS)
  const signal = createCombinedSignal([request.signal, timeoutSignal])

  const sttModel = process.env.OPENAI_STT_MODEL ?? 'gpt-4o-mini-transcribe'
  const sttLanguageDetectModel = process.env.OPENAI_STT_LANGUAGE_DETECT_MODEL ?? 'whisper-1'
  const client = new OpenAI({
    apiKey: providerApiKey,
    baseURL: providerBaseUrl && providerBaseUrl.length > 0 ? providerBaseUrl : undefined,
  })
  const startedAt = performance.now()

  try {
    const isStrictMultiLanguage = sttLanguageMode === 'strict' && allowedLanguages.length > 1
    let detectedLanguage: string | null = null

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

    return Response.json({
      turnId: meta.turnId,
      text,
      detectedLanguage: finalDetectedLanguage,
      latencyMs: Math.round(performance.now() - startedAt),
    })
  } catch (error) {
    if (signal.aborted || request.signal.aborted) {
      if (request.signal.aborted) {
        return jsonError(499, meta.turnId, 'Cancelled', 'STT request was cancelled')
      }

      return jsonError(504, meta.turnId, 'Timeout', 'STT request timed out')
    }

    const status = getErrorStatus(error)
    const message = getErrorMessage(error)
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
