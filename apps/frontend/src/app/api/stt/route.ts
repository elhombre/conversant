import OpenAI from 'openai'

const MAX_AUDIO_BYTES = 8 * 1024 * 1024
const STT_TIMEOUT_MS = 12_000

type SttMeta = {
  turnId: string
  preset?: string
  durationMs?: number
}

type SttErrorCode =
  | 'BadAudioFormat'
  | 'PayloadTooLarge'
  | 'NoSpeechDetected'
  | 'Timeout'
  | 'Cancelled'
  | 'ProviderUnavailable'
  | 'InternalError'

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

    return {
      turnId,
      preset,
      durationMs,
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

  if (audio.size === 0) {
    return jsonError(400, meta.turnId, 'BadAudioFormat', 'Audio file is empty')
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return jsonError(413, meta.turnId, 'PayloadTooLarge', 'Audio payload exceeds 8 MB')
  }

  const timeoutSignal = AbortSignal.timeout(STT_TIMEOUT_MS)
  const signal = createCombinedSignal([request.signal, timeoutSignal])

  const sttModel = process.env.OPENAI_STT_MODEL ?? 'gpt-4o-mini-transcribe'
  const client = new OpenAI({
    apiKey: providerApiKey,
    baseURL: providerBaseUrl && providerBaseUrl.length > 0 ? providerBaseUrl : undefined,
  })
  const startedAt = performance.now()

  try {
    const result = await client.audio.transcriptions.create(
      {
        file: audio,
        model: sttModel,
      },
      {
        signal,
      },
    )

    const text = result.text.trim()
    if (!text) {
      return jsonError(422, meta.turnId, 'NoSpeechDetected', 'No speech detected in utterance')
    }

    return Response.json({
      turnId: meta.turnId,
      text,
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
