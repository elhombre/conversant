import { type NextRequest, NextResponse } from 'next/server'
import { isUiLocale, UI_LOCALE_COOKIE_NAME } from '@/i18n/config'

type SetLocalePayload = {
  locale?: string
}

export async function POST(request: NextRequest) {
  let payload: SetLocalePayload | null = null
  try {
    payload = (await request.json()) as SetLocalePayload
  } catch {
    payload = null
  }

  const locale = payload?.locale
  if (typeof locale !== 'string' || !isUiLocale(locale)) {
    return NextResponse.json(
      {
        error: {
          code: 'BadRequest',
          message: 'Invalid locale.',
        },
      },
      { status: 400 },
    )
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set({
    name: UI_LOCALE_COOKIE_NAME,
    value: locale,
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  })

  return response
}
