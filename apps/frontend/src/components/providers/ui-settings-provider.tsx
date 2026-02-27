'use client'

import { NextIntlClientProvider } from 'next-intl'
import { useTheme } from 'next-themes'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_UI_LOCALE, isUiLocale, UI_LOCALE_STORAGE_KEY, type UiLocale } from '@/i18n/config'
import { UI_MESSAGES } from '@/i18n/messages'
import { ThemeProvider } from './theme-provider'

export type ThemeMode = 'system' | 'light' | 'dark'

type UiSettingsContextValue = {
  locale: UiLocale
  setLocale: (nextLocale: UiLocale) => void
  themeMode: ThemeMode
  setThemeMode: (nextTheme: ThemeMode) => void
  resolvedTheme: 'light' | 'dark' | undefined
}

const UiSettingsContext = createContext<UiSettingsContextValue | null>(null)

function normalizeResolvedTheme(theme: string | undefined): 'light' | 'dark' | undefined {
  if (theme === 'light' || theme === 'dark') {
    return theme
  }

  return undefined
}

function readStoredLocale(): UiLocale | null {
  try {
    const stored = window.localStorage.getItem(UI_LOCALE_STORAGE_KEY)
    if (typeof stored === 'string' && isUiLocale(stored)) {
      return stored
    }
  } catch {
    return null
  }

  return null
}

type UiSettingsBridgeProps = {
  children: ReactNode
  locale: UiLocale
  setLocale: (nextLocale: UiLocale) => void
}

function UiSettingsBridge({ children, locale, setLocale }: UiSettingsBridgeProps) {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const themeMode: ThemeMode = theme === 'light' || theme === 'dark' ? theme : 'system'
  const normalizedResolvedTheme = normalizeResolvedTheme(resolvedTheme)
  const setThemeMode = useCallback(
    (nextTheme: ThemeMode) => {
      setTheme(nextTheme)
    },
    [setTheme],
  )

  const contextValue = useMemo(
    () => ({
      locale,
      setLocale,
      themeMode,
      setThemeMode,
      resolvedTheme: normalizedResolvedTheme,
    }),
    [locale, normalizedResolvedTheme, setLocale, setThemeMode, themeMode],
  )

  return (
    <UiSettingsContext.Provider value={contextValue}>
      <NextIntlClientProvider locale={locale} messages={UI_MESSAGES[locale]}>
        {children}
      </NextIntlClientProvider>
    </UiSettingsContext.Provider>
  )
}

type UiSettingsProviderProps = {
  children: ReactNode
}

export function UiSettingsProvider({ children }: UiSettingsProviderProps) {
  const [locale, setLocaleState] = useState<UiLocale>(DEFAULT_UI_LOCALE)

  useEffect(() => {
    const fromStorage = readStoredLocale()
    if (fromStorage && fromStorage !== locale) {
      setLocaleState(fromStorage)
    }
  }, [locale])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((nextLocale: UiLocale) => {
    setLocaleState(nextLocale)
    try {
      window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, nextLocale)
    } catch {
      // Ignore localStorage failures (private mode/quota).
    }
  }, [])

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <UiSettingsBridge locale={locale} setLocale={setLocale}>
        {children}
      </UiSettingsBridge>
    </ThemeProvider>
  )
}

export function useUiSettings() {
  const value = useContext(UiSettingsContext)
  if (!value) {
    throw new Error('useUiSettings must be used within UiSettingsProvider')
  }

  return value
}
