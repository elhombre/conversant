import en from './locales/en.json'
import ru from './locales/ru.json'

export const UI_LOCALES = ['en', 'ru'] as const
export type UiLocale = (typeof UI_LOCALES)[number]

export const UI_LOCALE_STORAGE_KEY = 'conversant.ui.locale'

export const UI_DICTIONARIES: Record<UiLocale, typeof en> = {
  en,
  ru,
}
