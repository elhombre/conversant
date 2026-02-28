import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME } from '@/lib/auth/constants'

function isPublicAccessEnabledForMiddleware(): boolean {
  const raw = process.env.ALLOW_PUBLIC_ACCESS?.trim().toLowerCase()
  if (!raw) {
    return false
  }

  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

export function middleware(request: NextRequest) {
  if (isPublicAccessEnabledForMiddleware()) {
    return NextResponse.next()
  }

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
