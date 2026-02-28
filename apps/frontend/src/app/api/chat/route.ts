import OpenAI from 'openai'

const CHAT_TIMEOUT_MS = 15_000
const CHAT_MAX_TOKENS = 220

type PersonaId = 'Concise' | 'Conversational' | 'Interviewer'

type ChatBody = {
  turnId: string
  text: string
  personaId?: PersonaId
}

type ChatErrorCode = 'BadRequest' | 'Timeout' | 'Cancelled' | 'ProviderUnavailable' | 'InternalError'

const PERSONA_SYSTEM_PROMPTS: Record<PersonaId, string> = {
  Concise:
    'You are a concise voice assistant. Respond with one short, clear answer in 1-2 sentences unless user asks for detail.',
  Conversational:
    'You are a conversational voice assistant. Be natural, warm, and practical. Keep responses brief and easy to say aloud.',
  Interviewer:
    'You are an interviewer-style assistant. Be structured, ask clarifying follow-up questions when useful, and keep responses focused.',
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parseBody(rawBody: unknown): ChatBody | null {
  if (!rawBody || typeof rawBody !== 'object') {
    return null
  }

  const body = rawBody as {
    turnId?: unknown
    text?: unknown
    personaId?: unknown
  }

  const turnId = getString(body.turnId)
  const text = getString(body.text)
  if (!turnId || !text) {
    return null
  }

  let personaId: PersonaId | undefined
  if (typeof body.personaId === 'string' && body.personaId in PERSONA_SYSTEM_PROMPTS) {
    personaId = body.personaId as PersonaId
  }

  return {
    turnId,
    text,
    personaId,
  }
}

function jsonError(status: number, turnId: string | null, code: ChatErrorCode, message: string) {
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

  return 'Unknown LLM provider error'
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
      message: 'Cannot reach LLM provider. Check OPENAI_BASE_URL and model availability.',
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
      message: 'LLM request timed out',
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
    return jsonError(400, null, 'BadRequest', 'Invalid chat payload')
  }

  const timeoutSignal = AbortSignal.timeout(CHAT_TIMEOUT_MS)
  const signal = createCombinedSignal([request.signal, timeoutSignal])

  const chatModel = process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini'
  const personaId: PersonaId = body.personaId ?? 'Conversational'
  const systemPrompt = PERSONA_SYSTEM_PROMPTS[personaId]

  const client = new OpenAI({
    apiKey: providerApiKey,
    baseURL: providerBaseUrl && providerBaseUrl.length > 0 ? providerBaseUrl : undefined,
  })

  const startedAt = performance.now()

  try {
    const completion = await client.chat.completions.create(
      {
        model: chatModel,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: body.text,
          },
        ],
        max_tokens: CHAT_MAX_TOKENS,
      },
      { signal },
    )

    const text = completion.choices[0]?.message?.content?.trim() ?? ''
    if (!text) {
      return jsonError(500, body.turnId, 'InternalError', 'LLM returned empty response')
    }

    return Response.json({
      turnId: body.turnId,
      text,
      personaId,
      latencyMs: Math.round(performance.now() - startedAt),
    })
  } catch (error) {
    if (signal.aborted || request.signal.aborted) {
      if (request.signal.aborted) {
        return jsonError(499, body.turnId, 'Cancelled', 'Chat request was cancelled')
      }

      return jsonError(504, body.turnId, 'Timeout', 'Chat request timed out')
    }

    const status = getErrorStatus(error)
    const message = getErrorMessage(error)
    const mapped = mapProviderError(status, message)

    return jsonError(mapped.status, body.turnId, mapped.code, mapped.message)
  }
}
