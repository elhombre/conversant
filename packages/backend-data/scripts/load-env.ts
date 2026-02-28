import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function parseEnvFile(content: string): Record<string, string> {
  const entries: Record<string, string> = {}
  const lines = content.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue
    }

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const rawKey = trimmed.slice(0, separatorIndex).trim()
    const key = rawKey.startsWith('export ') ? rawKey.slice('export '.length).trim() : rawKey
    if (key.length === 0) {
      continue
    }

    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    if (rawValue.length >= 2) {
      const startsWithSingleQuote = rawValue.startsWith("'")
      const endsWithSingleQuote = rawValue.endsWith("'")
      const startsWithDoubleQuote = rawValue.startsWith('"')
      const endsWithDoubleQuote = rawValue.endsWith('"')

      if ((startsWithSingleQuote && endsWithSingleQuote) || (startsWithDoubleQuote && endsWithDoubleQuote)) {
        entries[key] = rawValue.slice(1, -1)
        continue
      }
    }

    entries[key] = rawValue
  }

  return entries
}

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return
  }

  const content = readFileSync(filePath, 'utf8')
  const entries = parseEnvFile(content)
  for (const [key, value] of Object.entries(entries)) {
    const current = process.env[key]
    if (typeof current === 'undefined' || current.trim().length === 0) {
      process.env[key] = value
    }
  }
}

export function loadInviteEnv() {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const packageRoot = resolve(scriptDir, '..')

  const candidates = [join(packageRoot, '.env.local'), join(packageRoot, '.env')]

  for (const filePath of candidates) {
    loadEnvFile(filePath)
  }
}
