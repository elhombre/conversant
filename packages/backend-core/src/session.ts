import type { SessionResetRequestBody, SessionResetSuccessPayload } from '@conversant/api-contracts'
import { type ConversationStore, getConversationStore } from './shared/conversation-store'
import { jsonError } from './shared/http'
import { asRecord, readNonEmptyString } from './shared/parsing'

export type SessionResetHandlerOptions = {
  userId?: string
  conversationStore?: ConversationStore
}

function parseBody(rawBody: unknown): SessionResetRequestBody | null {
  const body = asRecord(rawBody)
  if (!body) {
    return null
  }

  const conversationId = readNonEmptyString(body.conversationId)
  if (!conversationId) {
    return null
  }

  return {
    conversationId,
  }
}

export async function handleSessionResetPost(request: Request, options: SessionResetHandlerOptions = {}) {
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return jsonError(400, null, 'BadRequest', 'Invalid JSON payload')
  }

  const body = parseBody(rawBody)
  if (!body) {
    return jsonError(400, null, 'BadRequest', 'Invalid session reset payload')
  }

  const conversationStore = options.conversationStore ?? getConversationStore()
  try {
    await conversationStore.clearConversation({
      conversationId: body.conversationId,
      userId: options.userId,
    })
  } catch {
    return jsonError(500, null, 'InternalError', 'Failed to clear conversation state')
  }

  const payload: SessionResetSuccessPayload = {
    conversationId: body.conversationId,
    cleared: true,
  }

  return Response.json(payload, {
    headers: {
      'cache-control': 'no-store',
    },
  })
}
