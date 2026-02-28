import type { InviteConsumeFailureReason, InviteConsumeResult } from '@conversant/backend-data'
import {
  consumeInviteToken,
  resolveOrCreatePublicAccessUser,
  resolveSessionUser,
  revokeSessionByToken,
} from '@conversant/backend-data'
import { isProductionEnv, isPublicAccessEnabled } from '@conversant/config'
import type { NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME } from './constants'

export type AuthResult =
  | {
      ok: true
      userId: string
    }
  | {
      ok: false
      response: Response
    }

function parseCookieHeader(rawCookieHeader: string | null): Record<string, string> {
  if (!rawCookieHeader || rawCookieHeader.length === 0) {
    return {}
  }

  return rawCookieHeader.split(';').reduce<Record<string, string>>((result, chunk) => {
    const separatorIndex = chunk.indexOf('=')
    if (separatorIndex <= 0) {
      return result
    }

    const name = chunk.slice(0, separatorIndex).trim()
    const value = chunk.slice(separatorIndex + 1).trim()
    if (!name || !value) {
      return result
    }

    result[name] = decodeURIComponent(value)
    return result
  }, {})
}

export function readSessionTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie')
  const cookies = parseCookieHeader(cookieHeader)
  const rawToken = cookies[SESSION_COOKIE_NAME]

  if (!rawToken || rawToken.length === 0) {
    return null
  }

  return rawToken
}

export function applySessionCookie(response: NextResponse, sessionToken: string, expiresAt: Date) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionToken,
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

export async function requireAuthenticatedUser(request: Request): Promise<AuthResult> {
  if (isPublicAccessEnabled()) {
    const publicAccessUser = await resolveOrCreatePublicAccessUser()
    return {
      ok: true,
      userId: publicAccessUser.userId,
    }
  }

  const token = readSessionTokenFromRequest(request)
  if (!token) {
    return {
      ok: false,
      response: Response.json(
        {
          error: {
            code: 'Unauthorized',
            message: 'Authentication required',
          },
        },
        {
          status: 401,
          headers: {
            'cache-control': 'no-store',
          },
        },
      ),
    }
  }

  const session = await resolveSessionUser(token)
  if (!session) {
    return {
      ok: false,
      response: Response.json(
        {
          error: {
            code: 'Unauthorized',
            message: 'Invalid or expired session',
          },
        },
        {
          status: 401,
          headers: {
            'cache-control': 'no-store',
          },
        },
      ),
    }
  }

  return {
    ok: true,
    userId: session.userId,
  }
}

export async function revokeSessionFromRequest(request: Request) {
  const token = readSessionTokenFromRequest(request)
  if (!token) {
    return
  }

  await revokeSessionByToken(token)
}

export async function consumeInvite(inviteToken: string): Promise<InviteConsumeResult> {
  return consumeInviteToken(inviteToken)
}

export function getInviteErrorLabel(reason: InviteConsumeFailureReason) {
  switch (reason) {
    case 'invalid_token':
      return 'invalid'
    case 'token_used':
      return 'used'
    case 'token_expired':
      return 'expired'
    case 'token_revoked':
      return 'revoked'
    case 'misconfigured':
      return 'misconfigured'
  }
}
