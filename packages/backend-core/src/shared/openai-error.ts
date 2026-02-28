const DEFAULT_NETWORK_ERROR_MARKERS = [
  'not found',
  'connection error',
  'failed to fetch',
  'econnrefused',
  'enotfound',
  'network',
]

export function getProviderErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const candidate = (error as { status?: unknown }).status
  return typeof candidate === 'number' ? candidate : null
}

export function getProviderErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message
  }

  return fallbackMessage
}

export function isLikelyProviderNetworkError(
  status: number | null,
  message: string,
  extraMarkers: string[] = [],
): boolean {
  if (status === 404) {
    return true
  }

  const normalized = message.toLowerCase()
  return [...DEFAULT_NETWORK_ERROR_MARKERS, ...extraMarkers].some(marker => normalized.includes(marker))
}

export function isTimeoutStatus(status: number | null): boolean {
  return status === 408 || status === 504
}

export function isProviderUnavailableStatus(status: number | null): boolean {
  return status === 401 || status === 403 || status === 429 || (status !== null && status >= 500)
}
