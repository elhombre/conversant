import { NextResponse } from 'next/server'
import { applySessionCookie, consumeInvite, getInviteErrorLabel } from '@/lib/auth/server'

export const runtime = 'nodejs'

function getSafeNextPath(rawNext: string | null): string {
  if (!rawNext || rawNext.length === 0) {
    return '/'
  }

  if (!rawNext.startsWith('/') || rawNext.startsWith('//')) {
    return '/'
  }

  return rawNext
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const inviteToken = requestUrl.searchParams.get('token') ?? ''
  const nextPath = getSafeNextPath(requestUrl.searchParams.get('next'))
  const unavailableRedirectUrl = new URL('/invite-required', requestUrl)
  unavailableRedirectUrl.searchParams.set('auth_error', 'unavailable')

  try {
    const result = await consumeInvite(inviteToken)
    const redirectUrl = result.ok ? new URL(nextPath, requestUrl) : new URL('/invite-required', requestUrl)

    if (!result.ok) {
      redirectUrl.searchParams.set('auth_error', getInviteErrorLabel(result.reason))
      return NextResponse.redirect(redirectUrl)
    }

    const response = NextResponse.redirect(redirectUrl)
    applySessionCookie(response, result.sessionToken, result.sessionExpiresAt)
    return response
  } catch (error) {
    console.error('[invite.consume] unexpected error', error)
    return NextResponse.redirect(unavailableRedirectUrl)
  }
}
