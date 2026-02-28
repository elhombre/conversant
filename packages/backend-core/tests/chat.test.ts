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
      conversationId: 'c-1',
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
      conversationId: 'c-2',
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
      conversationId: 'c-3',
      turnId: 't-2',
      text: 'How are you?',
    })

    const response = await handleChatPost(request)
    const payload = await readJson(response)

    expect(response.status).toBe(200)
    expect(payload.conversationId).toBe('c-3')
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
        conversationId: 'c-4',
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
      conversationId: 'c-5',
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

  it('uses conversation history for subsequent turns in the same conversation', async () => {
    const chatCreateMock = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'First answer',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Second answer',
            },
          },
        ],
      })

    const mockClient = {
      chat: {
        completions: {
          create: chatCreateMock,
        },
      },
    }

    vi.mocked(createOpenAIClient).mockReturnValue(mockClient as unknown as OpenAIClient)

    const first = await handleChatPost(
      createJsonRequest('http://localhost/api/chat', {
        conversationId: 'history-c-1',
        turnId: 'h-1',
        text: 'First question',
      }),
    )
    expect(first.status).toBe(200)

    const second = await handleChatPost(
      createJsonRequest('http://localhost/api/chat', {
        conversationId: 'history-c-1',
        turnId: 'h-2',
        text: 'Second question',
      }),
    )
    expect(second.status).toBe(200)

    const secondCallArgs = chatCreateMock.mock.calls[1]
    expect(secondCallArgs).toBeDefined()

    const secondRequestPayload = asRecord(secondCallArgs?.[0])
    const messages = secondRequestPayload.messages as unknown[]
    expect(Array.isArray(messages)).toBe(true)
    expect(messages).toHaveLength(4)

    const historyUser = asRecord(messages[1])
    const historyAssistant = asRecord(messages[2])
    const latestUser = asRecord(messages[3])

    expect(historyUser.role).toBe('user')
    expect(historyUser.content).toBe('First question')
    expect(historyAssistant.role).toBe('assistant')
    expect(historyAssistant.content).toBe('First answer')
    expect(latestUser.role).toBe('user')
    expect(latestUser.content).toBe('Second question')
  })

  it('uses client-provided history when server conversation memory is empty', async () => {
    const chatCreateMock = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: 'Using fallback history',
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

    const response = await handleChatPost(
      createJsonRequest('http://localhost/api/chat', {
        conversationId: 'fallback-history-c-1',
        turnId: 'fh-1',
        text: 'What did I ask before?',
        history: [
          {
            role: 'user',
            content: 'Remember this fact',
          },
          {
            role: 'assistant',
            content: 'I remember this fact',
          },
        ],
      }),
    )

    expect(response.status).toBe(200)

    const callArgs = chatCreateMock.mock.calls[0]
    expect(callArgs).toBeDefined()
    const requestPayload = asRecord(callArgs?.[0])
    const messages = requestPayload.messages as unknown[]
    expect(Array.isArray(messages)).toBe(true)
    expect(messages).toHaveLength(4)

    const historyUser = asRecord(messages[1])
    const historyAssistant = asRecord(messages[2])
    const latestUser = asRecord(messages[3])

    expect(historyUser.role).toBe('user')
    expect(historyUser.content).toBe('Remember this fact')
    expect(historyAssistant.role).toBe('assistant')
    expect(historyAssistant.content).toBe('I remember this fact')
    expect(latestUser.role).toBe('user')
    expect(latestUser.content).toBe('What did I ask before?')
  })
})
