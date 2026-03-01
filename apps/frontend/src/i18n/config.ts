export const UI_LOCALES = ['en', 'ru'] as const

export type UiLocale = (typeof UI_LOCALES)[number]

export const UI_LOCALE_COOKIE_NAME = 'conversant.ui.locale'

export function isUiLocale(value: string): value is UiLocale {
  return UI_LOCALES.includes(value as UiLocale)
}
