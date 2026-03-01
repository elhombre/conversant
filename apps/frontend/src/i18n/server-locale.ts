import { cookies } from 'next/headers'
import { isUiLocale, UI_LOCALE_COOKIE_NAME, type UiLocale } from './config'

export async function resolveRequestLocale(): Promise<UiLocale> {
  const cookieStore = await cookies()
  const fromCookie = cookieStore.get(UI_LOCALE_COOKIE_NAME)?.value
  if (typeof fromCookie === 'string' && isUiLocale(fromCookie)) {
    return fromCookie
  }

  return 'en'
}
