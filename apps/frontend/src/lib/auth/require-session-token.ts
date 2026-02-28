import { isPublicAccessEnabled } from '@conversant/config'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE_NAME } from './constants'

export async function requireSessionTokenOrPublicAccess(): Promise<string | null> {
  if (isPublicAccessEnabled()) {
    return null
  }

  const cookieStore = await cookies()
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value?.trim()

  if (!sessionToken) {
    redirect('/invite-required')
  }

  return sessionToken
}
