import { consumeSessionPageAccess } from '@conversant/backend-data'
import { redirect } from 'next/navigation'
import { requireSessionTokenOrPublicAccess } from './require-session-token'

export async function consumePageAccessFromRequest() {
  const sessionToken = await requireSessionTokenOrPublicAccess()
  if (!sessionToken) {
    return
  }

  const pageAccess = await consumeSessionPageAccess(sessionToken)
  if (!pageAccess) {
    redirect('/invite-required?auth_error=session_reuse')
  }
}
