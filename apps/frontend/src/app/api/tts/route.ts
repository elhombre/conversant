import OpenAI from 'openai'

const TTS_TIMEOUT_MS = 15_000
const MAX_TTS_TEXT_CHARS = 4_000

type VoiceId = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'

type TtsBody = {
  turnId: string
  text: string
  voice: VoiceId
}

type TtsErrorCode = 'BadRequest' | 'Timeout' | 'Cancelled' | 'ProviderUnavailable' | 'InternalError'

const SUPPORTED_VOICES: ReadonlySet<VoiceId> = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'])

function isVoiceId(value: string): value is VoiceId {
  return SUPPORTED_VOICES.has(value as VoiceId)
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parseBody(rawBody: unknown): TtsBody | null {
  if (!rawBody || typeof rawBody !== 'object') {
    return null
  }

  const body = rawBody as {
    turnId?: unknown
    text?: unknown
    voice?: unknown
  }

  const turnId = getString(body.turnId)
  const text = getString(body.text)
  const voiceRaw = getString(body.voice)
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

function jsonError(status: number, turnId: string | null, code: TtsErrorCode, message: string) {
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

  return 'Unknown TTS provider error'
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

  if (status === 408 || status === 504) {
    return {
      status: 504,
      code: 'Timeout' as const,
      message: 'TTS request timed out',
    }
  }

  if (status === 401 || status === 403 || status === 429 || (status !== null && status >= 500)) {
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

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const providerApiKey = process.env.OPENAI_API_KEY
  const providerBaseUrl = process.env.OPENAI_BASE_URL?.trim()

  if (!providerApiKey) {
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

  const timeoutSignal = AbortSignal.timeout(TTS_TIMEOUT_MS)
  const signal = createCombinedSignal([request.signal, timeoutSignal])
  const ttsModel = process.env.OPENAI_TTS_MODEL ?? 'tts-1'

  const client = new OpenAI({
    apiKey: providerApiKey,
    baseURL: providerBaseUrl && providerBaseUrl.length > 0 ? providerBaseUrl : undefined,
  })

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
    if (signal.aborted || request.signal.aborted) {
      if (request.signal.aborted) {
        return jsonError(499, body.turnId, 'Cancelled', 'TTS request was cancelled')
      }

      return jsonError(504, body.turnId, 'Timeout', 'TTS request timed out')
    }

    const status = getErrorStatus(error)
    const message = getErrorMessage(error)
    const mapped = mapProviderError(status, message)

    return jsonError(mapped.status, body.turnId, mapped.code, mapped.message)
  }
}
