import { resolveOrCreatePublicAccessUser, resolveSessionUser } from '@conversant/backend-data'
import { redirect } from 'next/navigation'
import { requireSessionTokenOrPublicAccess } from './require-session-token'

export async function requireSessionUserIdFromCookies() {
  const sessionToken = await requireSessionTokenOrPublicAccess()
  if (!sessionToken) {
    const publicAccessUser = await resolveOrCreatePublicAccessUser()
    return publicAccessUser.userId
  }

  const session = await resolveSessionUser(sessionToken)
  if (!session) {
    redirect('/invite-required')
  }

  return session.userId
}
