import { NextResponse } from 'next/server'
import { clearSessionCookie, revokeSessionFromRequest } from '@/lib/auth/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  await revokeSessionFromRequest(request)

  const response = NextResponse.json(
    {
      ok: true,
    },
    {
      headers: {
        'cache-control': 'no-store',
      },
    },
  )
  clearSessionCookie(response)
  return response
}
