import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME } from '@/lib/auth/constants'

export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (sessionCookie && sessionCookie.length > 0) {
    return NextResponse.next()
  }

  const redirectUrl = new URL('/invite-required', request.url)
  return NextResponse.redirect(redirectUrl)
}

export const config = {
  matcher: ['/', '/conversation-ended/:path*'],
}
