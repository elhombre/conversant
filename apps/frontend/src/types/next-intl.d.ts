import type en from '@/i18n/messages/en.json'
import type { UiLocale } from '@/i18n/config'

declare module 'next-intl' {
  interface AppConfig {
    Locale: UiLocale
    Messages: typeof en
  }
}
