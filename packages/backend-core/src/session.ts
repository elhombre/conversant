import type { SessionResetRequestBody, SessionResetSuccessPayload } from '@conversant/api-contracts'
import { getConversationStore } from './shared/conversation-store'
import { jsonError } from './shared/http'
import { asRecord, readNonEmptyString } from './shared/parsing'

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

export async function handleSessionResetPost(request: Request) {
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

  const conversationStore = getConversationStore()
  conversationStore.clearConversation(body.conversationId)

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
