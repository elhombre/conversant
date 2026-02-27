import { getConversationTranscript } from '@conversant/backend-data'
import { requireAuthenticatedUser } from '@/lib/auth/server'

export const runtime = 'nodejs'

type TranscriptMessagePayload = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  turnId: string | null
  createdAt: string
}

type TranscriptPayload = {
  conversationId: string
  startedAt: string | null
  endedAt: string | null
  durationLimitSec: number | null
  messages: TranscriptMessagePayload[]
}

function jsonNoStore(body: TranscriptPayload, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
    },
  })
}

export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser(request)
  if (!auth.ok) {
    return auth.response
  }

  const requestUrl = new URL(request.url)
  const conversationId = requestUrl.searchParams.get('conversationId')?.trim() ?? ''
  if (conversationId.length === 0) {
    return Response.json(
      {
        error: {
          code: 'BadRequest',
          message: 'conversationId query parameter is required',
        },
      },
      {
        status: 400,
        headers: {
          'cache-control': 'no-store',
        },
      },
    )
  }

  const transcript = await getConversationTranscript({
    conversationId,
    userId: auth.userId,
  })

  if (!transcript) {
    return jsonNoStore({
      conversationId,
      startedAt: null,
      endedAt: null,
      durationLimitSec: null,
      messages: [],
    })
  }

  return jsonNoStore({
    conversationId: transcript.conversationId,
    startedAt: transcript.startedAt.toISOString(),
    endedAt: transcript.endedAt ? transcript.endedAt.toISOString() : null,
    durationLimitSec: transcript.durationLimitSec,
    messages: transcript.messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      turnId: message.turnId,
      createdAt: message.createdAt.toISOString(),
    })),
  })
}
