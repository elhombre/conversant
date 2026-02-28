import { handleSessionResetPost } from '@conversant/backend-core'
import { requireAuthenticatedUser } from '@/lib/auth/server'
import { serverConversationStore } from '@/lib/conversation/server-store'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request)
  if (!auth.ok) {
    return auth.response
  }

  return handleSessionResetPost(request, {
    userId: auth.userId,
    conversationStore: serverConversationStore,
  })
}
