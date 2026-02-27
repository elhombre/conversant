import { requireAuthenticatedUser } from '@/lib/auth/server'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser(request)
  if (!auth.ok) {
    return Response.json(
      {
        authenticated: false,
      },
      {
        status: 200,
        headers: {
          'cache-control': 'no-store',
        },
      },
    )
  }

  return Response.json(
    {
      authenticated: true,
      userId: auth.userId,
    },
    {
      headers: {
        'cache-control': 'no-store',
      },
    },
  )
}
