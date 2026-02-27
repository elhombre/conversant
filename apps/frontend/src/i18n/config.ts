export const UI_LOCALES = ['en', 'ru'] as const

export type UiLocale = (typeof UI_LOCALES)[number]

export const DEFAULT_UI_LOCALE: UiLocale = 'en'
export const UI_LOCALE_STORAGE_KEY = 'conversant.ui.locale'

export function isUiLocale(value: string): value is UiLocale {
  return UI_LOCALES.includes(value as UiLocale)
}
