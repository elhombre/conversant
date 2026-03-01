'use client'

import { useTranslations } from 'next-intl'
import { useCallback } from 'react'
import type messages from '@/i18n/messages/en.json'

type Join<K, P> = K extends string | number ? (P extends string | number ? `${K}.${P}` : never) : never
type Prev = [never, 0, 1, 2, 3, 4, 5]

type LeafPaths<T, D extends number = 5> = [D] extends [never]
  ? never
  : T extends Record<string, unknown>
    ? {
        [K in keyof T & string]: T[K] extends Record<string, unknown> ? Join<K, LeafPaths<T[K], Prev[D]>> : K
      }[keyof T & string]
    : never

export type MessageKeys = LeafPaths<typeof messages>

type TranslationValues = Record<string, string | number | Date>

export function useTypedTranslations() {
  const t = useTranslations()
  return useCallback((key: MessageKeys, values?: TranslationValues) => t(key, values), [t])
}
