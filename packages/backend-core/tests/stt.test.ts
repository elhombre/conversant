import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenAIClient, getOpenAIProviderConfig } from '../src/shared/openai-client'
import { handleSttPost } from '../src/stt'
import { asRecord, createAudioFile, createSttRequest, readError, readJson } from './test-utils'

vi.mock('../src/shared/openai-client', () => ({
  createOpenAIClient: vi.fn(),
  getOpenAIProviderConfig: vi.fn(),
}))

type OpenAIClient = ReturnType<typeof createOpenAIClient>

describe('handleSttPost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getOpenAIProviderConfig).mockReturnValue({
      apiKey: 'test-key',
      baseURL: 'http://provider.local/v1',
    })
  })

  it('returns bad audio format for invalid payload', async () => {
    const request = createSttRequest({
      turnId: 's-1',
      sttLanguageMode: 'off',
    })

    const response = await handleSttPost(request)
    const payload = await readJson(response)
    const error = readError(payload)

    expect(response.status).toBe(400)
    expect(error.code).toBe('BadAudioFormat')
  })

  it('returns unsupported language when strict mode has empty allowed list', async () => {
    const request = createSttRequest(
      {
        turnId: 's-2',
        sttLanguageMode: 'strict',
        allowedLanguages: [],
      },
      createAudioFile(),
    )

    const response = await handleSttPost(request)
    const payload = await readJson(response)
    const error = readError(payload)

    expect(response.status).toBe(400)
    expect(error.code).toBe('UnsupportedLanguage')
  })

  it('transcribes with forced language in strict single-language mode', async () => {
    let capturedLanguage: string | undefined

    const transcriptionCreateMock = vi.fn(async (payload: unknown) => {
      const requestPayload = asRecord(payload)
      capturedLanguage = typeof requestPayload.language === 'string' ? requestPayload.language : undefined

      return {
        text: '  привет  ',
        language: 'ru',
      }
    })

    const mockClient = {
      audio: {
        transcriptions: {
          create: transcriptionCreateMock,
        },
      },
    }

    vi.mocked(createOpenAIClient).mockReturnValue(mockClient as unknown as OpenAIClient)

    const request = createSttRequest(
      {
        turnId: 's-3',
        sttLanguageMode: 'strict',
        allowedLanguages: ['ru'],
      },
      createAudioFile(),
    )

    const response = await handleSttPost(request)
    const payload = await readJson(response)

    expect(response.status).toBe(200)
    expect(payload.turnId).toBe('s-3')
    expect(payload.text).toBe('привет')
    expect(payload.detectedLanguage).toBe('ru')
    expect(capturedLanguage).toBe('ru')
    expect(transcriptionCreateMock).toHaveBeenCalledTimes(1)
  })

  it('rejects strict multi-language mode when detected language is outside allowed set', async () => {
    let callCount = 0

    const transcriptionCreateMock = vi.fn(async () => {
      callCount += 1
      if (callCount === 1) {
        return {
          text: '',
          language: 'en',
        }
      }

      return {
        text: 'should not happen',
        language: 'en',
      }
    })

    const mockClient = {
      audio: {
        transcriptions: {
          create: transcriptionCreateMock,
        },
      },
    }

    vi.mocked(createOpenAIClient).mockReturnValue(mockClient as unknown as OpenAIClient)

    const request = createSttRequest(
      {
        turnId: 's-4',
        sttLanguageMode: 'strict',
        allowedLanguages: ['ru', 'es'],
      },
      createAudioFile(),
    )

    const response = await handleSttPost(request)
    const payload = await readJson(response)
    const error = readError(payload)

    expect(response.status).toBe(400)
    expect(error.code).toBe('UnsupportedLanguage')
    expect(callCount).toBe(1)
  })

  it('returns provider-specific guidance for unsupported transcription endpoint', async () => {
    const transcriptionCreateMock = vi.fn(async () => {
      const error = new Error('404 page not found') as Error & { status?: number }
      error.status = 404
      throw error
    })

    const mockClient = {
      audio: {
        transcriptions: {
          create: transcriptionCreateMock,
        },
      },
    }

    vi.mocked(createOpenAIClient).mockReturnValue(mockClient as unknown as OpenAIClient)

    const request = createSttRequest(
      {
        turnId: 's-5',
        sttLanguageMode: 'off',
      },
      createAudioFile(),
    )

    const response = await handleSttPost(request)
    const payload = await readJson(response)
    const error = readError(payload)

    expect(response.status).toBe(500)
    expect(error.code).toBe('ProviderUnavailable')
    expect(error.message).toBe(
      'Configured provider does not support /audio/transcriptions. Use an OpenAI-compatible STT endpoint.',
    )
  })
})
