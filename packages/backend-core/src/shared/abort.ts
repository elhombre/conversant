export function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }
  }

  const abort = (event: Event) => {
    const target = event.target
    if (target instanceof AbortSignal) {
      controller.abort(target.reason)
      return
    }

    controller.abort('aborted')
  }

  for (const signal of signals) {
    signal.addEventListener('abort', abort, { once: true })
  }

  return controller.signal
}

export function createRequestSignal(requestSignal: AbortSignal, timeoutMs: number): AbortSignal {
  return combineAbortSignals([requestSignal, AbortSignal.timeout(timeoutMs)])
}

export function getAbortKind(signal: AbortSignal, requestSignal: AbortSignal): 'cancelled' | 'timeout' | null {
  if (!signal.aborted && !requestSignal.aborted) {
    return null
  }

  return requestSignal.aborted ? 'cancelled' : 'timeout'
}
