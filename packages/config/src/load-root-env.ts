import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

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

function loadEnvFile(filePath: string, targetEnv: NodeJS.ProcessEnv) {
  if (!existsSync(filePath)) {
    return
  }

  const content = readFileSync(filePath, 'utf8')
  const entries = parseEnvFile(content)

  for (const [key, value] of Object.entries(entries)) {
    const current = targetEnv[key]
    if (typeof current === 'undefined' || current.trim().length === 0) {
      targetEnv[key] = value
    }
  }
}

function findEnvRoot(startDir: string): string {
  let cursor = resolve(startDir)

  while (true) {
    if (existsSync(join(cursor, '.env')) || existsSync(join(cursor, '.env.local'))) {
      return cursor
    }

    const parent = dirname(cursor)
    if (parent === cursor) {
      return resolve(startDir)
    }

    cursor = parent
  }
}

export function loadRootEnv(options: { startDir?: string; targetEnv?: NodeJS.ProcessEnv } = {}) {
  const startDir = options.startDir ?? process.cwd()
  const targetEnv = options.targetEnv ?? process.env
  const rootDir = findEnvRoot(startDir)

  const candidates = [join(rootDir, '.env.local'), join(rootDir, '.env')]
  for (const filePath of candidates) {
    loadEnvFile(filePath, targetEnv)
  }
}
