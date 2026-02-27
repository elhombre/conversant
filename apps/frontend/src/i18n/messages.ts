import type { UiLocale } from './config'
import en from './messages/en.json'
import ru from './messages/ru.json'

export const UI_MESSAGES: Record<UiLocale, typeof en> = {
  en,
  ru,
}
