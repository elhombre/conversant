import { type ChatHistoryMessage, type ChatRequestBody, PERSONA_IDS, type PersonaId } from '@conversant/api-contracts'
import { readOpenAIModelEnv, readOpenAIProviderEnv } from '@conversant/config'

import { createRequestSignal, getAbortKind } from './shared/abort'
import { getConversationStore } from './shared/conversation-store'
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

const CHAT_TIMEOUT_MS = 15_000
const CHAT_MAX_TOKENS = 220
const CHAT_MAX_HISTORY_MESSAGES = 24

const PERSONA_SYSTEM_PROMPTS: Record<PersonaId, string> = {
  Concise:
    'You are a concise voice assistant. Respond with one short, clear answer in 1-2 sentences unless user asks for detail.',
  Conversational:
    'You are a conversational voice assistant. Be natural, warm, and practical. Keep responses brief and easy to say aloud.',
  Interviewer:
    'You are an interviewer-style assistant. Be structured, ask clarifying follow-up questions when useful, and keep responses focused.',
}

function isPersonaId(value: string): value is PersonaId {
  return PERSONA_IDS.some(persona => persona === value)
}

function parseChatHistory(rawHistory: unknown): ChatHistoryMessage[] | undefined {
  if (!Array.isArray(rawHistory)) {
    return undefined
  }

  const parsed: ChatHistoryMessage[] = []
  for (const item of rawHistory) {
    const record = asRecord(item)
    if (!record) {
      continue
    }

    const role = readNonEmptyString(record.role)
    const content = readNonEmptyString(record.content)
    if (!content || (role !== 'user' && role !== 'assistant')) {
      continue
    }

    parsed.push({ role, content })
  }

  return parsed.length > 0 ? parsed : undefined
}

function parseBody(rawBody: unknown): ChatRequestBody | null {
  const body = asRecord(rawBody)
  if (!body) {
    return null
  }

  const turnId = readNonEmptyString(body.turnId)
  const text = readNonEmptyString(body.text)
  const conversationId = readNonEmptyString(body.conversationId)
  if (!turnId || !text || !conversationId) {
    return null
  }

  const personaRaw = readNonEmptyString(body.personaId)
  const personaId = personaRaw && isPersonaId(personaRaw) ? personaRaw : undefined
  const history = parseChatHistory(body.history)

  return {
    conversationId,
    turnId,
    text,
    personaId,
    history,
  }
}

function mapProviderError(status: number | null, message: string) {
  if (isLikelyProviderNetworkError(status, message)) {
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

  if (isTimeoutStatus(status)) {
    return {
      status: 504,
      code: 'Timeout' as const,
      message: 'LLM request timed out',
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

export async function handleChatPost(request: Request) {
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
    return jsonError(400, null, 'BadRequest', 'Invalid chat payload')
  }

  const signal = createRequestSignal(request.signal, CHAT_TIMEOUT_MS)
  const modelConfig = readOpenAIModelEnv()
  const chatModel = modelConfig.chatModel
  const personaId: PersonaId = body.personaId ?? 'Conversational'
  const systemPrompt = PERSONA_SYSTEM_PROMPTS[personaId]
  const conversationStore = getConversationStore()
  const serverHistory = conversationStore.getHistory(body.conversationId)
  const history = (serverHistory.length > 0 ? serverHistory : (body.history ?? [])).slice(-CHAT_MAX_HISTORY_MESSAGES)

  const client = createOpenAIClient(providerConfig)
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
          ...history,
          {
            role: 'user',
            content: body.text,
          },
        ],
        max_completion_tokens: CHAT_MAX_TOKENS,
      },
      { signal },
    )

    const text = completion.choices[0]?.message?.content?.trim() ?? ''
    if (!text) {
      return jsonError(500, body.turnId, 'InternalError', 'LLM returned empty response')
    }
    conversationStore.appendTurn(body.conversationId, body.text, text)

    return Response.json(
      {
        conversationId: body.conversationId,
        turnId: body.turnId,
        text,
        personaId,
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
      return jsonError(499, body.turnId, 'Cancelled', 'Chat request was cancelled')
    }

    if (abortKind === 'timeout') {
      return jsonError(504, body.turnId, 'Timeout', 'Chat request timed out')
    }

    const status = getProviderErrorStatus(error)
    const message = getProviderErrorMessage(error, 'Unknown LLM provider error')
    const mapped = mapProviderError(status, message)

    return jsonError(mapped.status, body.turnId, mapped.code, mapped.message)
  }
}
