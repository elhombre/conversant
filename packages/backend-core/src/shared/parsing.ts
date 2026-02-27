export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  return value as Record<string, unknown>
}

type ReadStringOptions = {
  trim?: boolean
}

export function readNonEmptyString(value: unknown, options: ReadStringOptions = {}): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = options.trim === false ? value : value.trim()
  return normalized.length > 0 ? normalized : null
}
