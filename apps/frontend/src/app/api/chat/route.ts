import { handleChatPost } from '@conversant/backend-core'
import { requireAuthenticatedUser } from '@/lib/auth/server'
import { serverConversationStore } from '@/lib/conversation/server-store'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request)
  if (!auth.ok) {
    return auth.response
  }

  return handleChatPost(request, {
    userId: auth.userId,
    conversationMaxDurationSec: auth.conversationMaxDurationSec,
    conversationStore: serverConversationStore,
  })
}
