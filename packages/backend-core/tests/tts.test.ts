import { readOpenAIProviderEnv } from '@conversant/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenAIClient } from '../src/shared/openai-client'
import { handleTtsPost } from '../src/tts'
import { createJsonRequest, readError, readJson } from './test-utils'

vi.mock('../src/shared/openai-client', () => ({
  createOpenAIClient: vi.fn(),
}))

vi.mock('@conversant/config', () => ({
  readOpenAIProviderEnv: vi.fn(),
  readOpenAIModelEnv: vi.fn(() => ({
    chatModel: 'gpt-4o-mini',
    sttModel: 'gpt-4o-mini-transcribe',
    sttLanguageDetectModel: 'whisper-1',
    ttsModel: 'tts-1',
  })),
}))

type OpenAIClient = ReturnType<typeof createOpenAIClient>

describe('handleTtsPost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readOpenAIProviderEnv).mockReturnValue({
      apiKey: 'test-key',
      baseURL: 'http://provider.local/v1',
    })
  })

  it('returns bad request for invalid payload', async () => {
    const request = createJsonRequest('http://localhost/api/tts', {
      turnId: '',
      text: '',
      voice: 'alloy',
    })

    const response = await handleTtsPost(request)
    const payload = await readJson(response)
    const error = readError(payload)

    expect(response.status).toBe(400)
    expect(error.code).toBe('BadRequest')
  })

  it('returns mp3 bytes for valid payload', async () => {
    const speechCreateMock = vi.fn(async () => ({
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    }))

    const mockClient = {
      audio: {
        speech: {
          create: speechCreateMock,
        },
      },
    }

    vi.mocked(createOpenAIClient).mockReturnValue(mockClient as unknown as OpenAIClient)

    const request = createJsonRequest('http://localhost/api/tts', {
      turnId: 'v-2',
      text: 'Hello there',
      voice: 'alloy',
    })

    const response = await handleTtsPost(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/mpeg')
    expect(response.headers.get('x-turn-id')).toBe('v-2')

    const audio = new Uint8Array(await response.arrayBuffer())
    expect(audio.byteLength).toBe(3)
    expect(speechCreateMock).toHaveBeenCalledTimes(1)
  })

  it('returns cancelled when request signal is aborted', async () => {
    const speechCreateMock = vi.fn(async () => {
      throw new Error('aborted')
    })

    const mockClient = {
      audio: {
        speech: {
          create: speechCreateMock,
        },
      },
    }

    vi.mocked(createOpenAIClient).mockReturnValue(mockClient as unknown as OpenAIClient)

    const controller = new AbortController()
    controller.abort('user-cancelled')

    const request = createJsonRequest(
      'http://localhost/api/tts',
      {
        turnId: 'v-3',
        text: 'cancel me',
        voice: 'alloy',
      },
      controller.signal,
    )

    const response = await handleTtsPost(request)
    const payload = await readJson(response)
    const error = readError(payload)

    expect(response.status).toBe(499)
    expect(error.code).toBe('Cancelled')
  })

  it('maps provider timeout status to Timeout', async () => {
    const speechCreateMock = vi.fn(async () => {
      const error = new Error('upstream timeout') as Error & { status?: number }
      error.status = 504
      throw error
    })

    const mockClient = {
      audio: {
        speech: {
          create: speechCreateMock,
        },
      },
    }

    vi.mocked(createOpenAIClient).mockReturnValue(mockClient as unknown as OpenAIClient)

    const request = createJsonRequest('http://localhost/api/tts', {
      turnId: 'v-4',
      text: 'Hello',
      voice: 'alloy',
    })

    const response = await handleTtsPost(request)
    const payload = await readJson(response)
    const error = readError(payload)

    expect(response.status).toBe(504)
    expect(error.code).toBe('Timeout')
    expect(error.message).toBe('TTS request timed out')
  })

  it('maps provider network errors to ProviderUnavailable', async () => {
    const speechCreateMock = vi.fn(async () => {
      const error = new Error('failed to fetch') as Error & { status?: number }
      error.status = 404
      throw error
    })

    const mockClient = {
      audio: {
        speech: {
          create: speechCreateMock,
        },
      },
    }

    vi.mocked(createOpenAIClient).mockReturnValue(mockClient as unknown as OpenAIClient)

    const request = createJsonRequest('http://localhost/api/tts', {
      turnId: 'v-5',
      text: 'Hello',
      voice: 'alloy',
    })

    const response = await handleTtsPost(request)
    const payload = await readJson(response)
    const error = readError(payload)

    expect(response.status).toBe(500)
    expect(error.code).toBe('ProviderUnavailable')
    expect(error.message).toBe('Cannot reach TTS provider. Check OPENAI_BASE_URL and model availability.')
  })
})
