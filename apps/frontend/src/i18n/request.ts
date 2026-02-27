import { getRequestConfig } from 'next-intl/server'
import { DEFAULT_UI_LOCALE } from './config'
import { UI_MESSAGES } from './messages'

export default getRequestConfig(async () => {
  const locale = DEFAULT_UI_LOCALE

  return {
    locale,
    messages: UI_MESSAGES[locale],
  }
})
