import { handleTtsPost } from '@conversant/backend-core'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return handleTtsPost(request)
}
