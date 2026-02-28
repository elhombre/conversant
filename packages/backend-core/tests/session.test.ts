import { describe, expect, it, vi } from 'vitest'

import { handleChatPost } from '../src/chat'
import { handleSessionResetPost } from '../src/session'
import { createOpenAIClient, getOpenAIProviderConfig } from '../src/shared/openai-client'
import { asRecord, createJsonRequest, readError, readJson } from './test-utils'

vi.mock('../src/shared/openai-client', () => ({
  createOpenAIClient: vi.fn(),
  getOpenAIProviderConfig: vi.fn(),
}))

type OpenAIClient = ReturnType<typeof createOpenAIClient>

describe('handleSessionResetPost', () => {
  it('returns bad request for invalid payload', async () => {
    const response = await handleSessionResetPost(
      createJsonRequest('http://localhost/api/session/reset', {
        conversationId: '',
      }),
    )

    const payload = await readJson(response)
    const error = readError(payload)

    expect(response.status).toBe(400)
    expect(error.code).toBe('BadRequest')
  })

  it('clears server-side conversation history for chat context', async () => {
    vi.mocked(getOpenAIProviderConfig).mockReturnValue({
      apiKey: 'test-key',
      baseURL: 'http://provider.local/v1',
    })

    const chatCreateMock = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Answer one',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Answer two',
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

    const conversationId = 'reset-c-1'

    const first = await handleChatPost(
      createJsonRequest('http://localhost/api/chat', {
        conversationId,
        turnId: 'reset-1',
        text: 'Question one',
      }),
    )
    expect(first.status).toBe(200)

    const reset = await handleSessionResetPost(
      createJsonRequest('http://localhost/api/session/reset', {
        conversationId,
      }),
    )
    expect(reset.status).toBe(200)

    const resetPayload = await readJson(reset)
    expect(resetPayload.conversationId).toBe(conversationId)
    expect(resetPayload.cleared).toBe(true)

    const second = await handleChatPost(
      createJsonRequest('http://localhost/api/chat', {
        conversationId,
        turnId: 'reset-2',
        text: 'Question two',
      }),
    )
    expect(second.status).toBe(200)

    const secondCallArgs = chatCreateMock.mock.calls[1]
    expect(secondCallArgs).toBeDefined()

    const secondRequestPayload = asRecord(secondCallArgs?.[0])
    const messages = secondRequestPayload.messages as unknown[]
    expect(Array.isArray(messages)).toBe(true)
    expect(messages).toHaveLength(2)

    const systemMessage = asRecord(messages[0])
    const userMessage = asRecord(messages[1])

    expect(systemMessage.role).toBe('system')
    expect(userMessage.role).toBe('user')
    expect(userMessage.content).toBe('Question two')
  })
})
