import { resolveSessionUser } from '@conversant/backend-data'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE_NAME } from './constants'

export async function requireSessionUserIdFromCookies() {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value

  if (!sessionToken || sessionToken.length === 0) {
    redirect('/invite-required')
  }

  const session = await resolveSessionUser(sessionToken)
  if (!session) {
    redirect('/invite-required')
  }

  return session.userId
}
