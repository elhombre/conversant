import { handleTtsPost } from '@conversant/backend-core'
import { requireAuthenticatedUser } from '@/lib/auth/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request)
  if (!auth.ok) {
    return auth.response
  }

  return handleTtsPost(request)
}
