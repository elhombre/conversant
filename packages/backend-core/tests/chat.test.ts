import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleChatPost } from '../src/chat'
import { createOpenAIClient, getOpenAIProviderConfig } from '../src/shared/openai-client'
import { asRecord, createJsonRequest, readError, readJson } from './test-utils'

vi.mock('../src/shared/openai-client', () => ({
  createOpenAIClient: vi.fn(),
  getOpenAIProviderConfig: vi.fn(),
}))

type OpenAIClient = ReturnType<typeof createOpenAIClient>

describe('handleChatPost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getOpenAIProviderConfig).mockReturnValue({
      apiKey: 'test-key',
      baseURL: 'http://provider.local/v1',
    })
  })

  it('returns provider unavailable when OPENAI_API_KEY is missing', async () => {
    vi.mocked(getOpenAIProviderConfig).mockReturnValue(null)

    const request = createJsonRequest('http://localhost/api/chat', {
      turnId: 't-1',
      text: 'hello',
    })

    const response = await handleChatPost(request)
    const payload = await readJson(response)
    const error = readError(payload)

    expect(response.status).toBe(500)
    expect(error.code).toBe('ProviderUnavailable')
  })

  it('returns bad request for invalid payload', async () => {
    const request = createJsonRequest('http://localhost/api/chat', {
      turnId: '',
      text: '',
    })

    const response = await handleChatPost(request)
    const payload = await readJson(response)
    const error = readError(payload)

    expect(response.status).toBe(400)
    expect(error.code).toBe('BadRequest')
  })

  it('returns chat completion for valid request', async () => {
    const chatCreateMock = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: '  Hello from model  ',
          },
        },
      ],
    }))

    const mockClient = {
      chat: {
        completions: {
          create: chatCreateMock,
        },
      },
    }

    vi.mocked(createOpenAIClient).mockReturnValue(mockClient as unknown as OpenAIClient)

    const request = createJsonRequest('http://localhost/api/chat', {
      turnId: 't-2',
      text: 'How are you?',
    })

    const response = await handleChatPost(request)
    const payload = await readJson(response)

    expect(response.status).toBe(200)
    expect(payload.turnId).toBe('t-2')
    expect(payload.text).toBe('Hello from model')
    expect(payload.personaId).toBe('Conversational')
    expect(typeof payload.latencyMs).toBe('number')

    const callArgs = chatCreateMock.mock.calls[0]
    expect(callArgs).toBeDefined()

    const requestPayload = asRecord(callArgs?.[0])
    expect(requestPayload.model).toBe('gpt-4o-mini')
  })

  it('returns cancelled when request signal is aborted', async () => {
    const chatCreateMock = vi.fn(async () => {
      throw new Error('aborted')
    })

    const mockClient = {
      chat: {
        completions: {
          create: chatCreateMock,
        },
      },
    }

    vi.mocked(createOpenAIClient).mockReturnValue(mockClient as unknown as OpenAIClient)

    const controller = new AbortController()
    controller.abort('user-cancelled')

    const request = createJsonRequest(
      'http://localhost/api/chat',
      {
        turnId: 't-3',
        text: 'hello',
      },
      controller.signal,
    )

    const response = await handleChatPost(request)
    const payload = await readJson(response)
    const error = readError(payload)

    expect(response.status).toBe(499)
    expect(error.code).toBe('Cancelled')
  })

  it('maps provider network errors to ProviderUnavailable', async () => {
    const chatCreateMock = vi.fn(async () => {
      const error = new Error('connection error: not found') as Error & { status?: number }
      error.status = 404
      throw error
    })

    const mockClient = {
      chat: {
        completions: {
          create: chatCreateMock,
        },
      },
    }

    vi.mocked(createOpenAIClient).mockReturnValue(mockClient as unknown as OpenAIClient)

    const request = createJsonRequest('http://localhost/api/chat', {
      turnId: 't-4',
      text: 'hello',
    })

    const response = await handleChatPost(request)
    const payload = await readJson(response)
    const error = readError(payload)

    expect(response.status).toBe(500)
    expect(error.code).toBe('ProviderUnavailable')
    expect(error.message).toBe('Cannot reach LLM provider. Check OPENAI_BASE_URL and model availability.')
  })
})
