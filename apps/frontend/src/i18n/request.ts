import { getRequestConfig } from 'next-intl/server'
import { UI_MESSAGES } from './messages'
import { resolveRequestLocale } from './server-locale'

export default getRequestConfig(async () => {
  const locale = await resolveRequestLocale()

  return {
    locale,
    messages: UI_MESSAGES[locale],
  }
})
