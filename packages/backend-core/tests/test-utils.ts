export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error('Expected object payload')
  }

  return value as Record<string, unknown>
}

export function createJsonRequest(url: string, body: unknown, signal?: AbortSignal): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
}

export function createSttRequest(meta: unknown, audio?: File, signal?: AbortSignal): Request {
  const formData = new FormData()
  if (audio) {
    formData.set('audio', audio)
  }

  formData.set('meta', JSON.stringify(meta))

  return new Request('http://localhost/api/stt', {
    method: 'POST',
    body: formData,
    signal,
  })
}

export function createAudioFile(size = 3): File {
  const bytes = new Uint8Array(size)
  bytes.fill(7)

  return new File([bytes], 'sample.webm', {
    type: 'audio/webm',
  })
}

export async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload = (await response.json()) as unknown
  return asRecord(payload)
}

export function readError(payload: Record<string, unknown>): Record<string, unknown> {
  return asRecord(payload.error)
}
