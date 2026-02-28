import { consumeSessionPageAccess } from '@conversant/backend-data'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE_NAME } from './constants'

export async function consumePageAccessFromRequest() {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value

  if (!sessionToken || sessionToken.length === 0) {
    redirect('/invite-required')
  }

  const pageAccess = await consumeSessionPageAccess(sessionToken)
  if (!pageAccess) {
    redirect('/invite-required?auth_error=session_reuse')
  }
}
