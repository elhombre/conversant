import { readAssistantRuntimeEnv, readOpenAIProviderEnv } from '@conversant/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleChatPost } from '../src/chat'
import { createOpenAIClient } from '../src/shared/openai-client'
import { handleSttPost } from '../src/stt'
import { handleTtsPost } from '../src/tts'
import { asRecord, createAudioFile, createJsonRequest, createSttRequest, readError, readJson } from './test-utils'

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
  readAssistantRuntimeEnv: vi.fn(() => ({
    conversationMaxDurationSec: null,
    assistantSystemPrompt: null,
    assistantMaxOutputTokens: 220,
  })),
}))

type OpenAIClient = ReturnType<typeof createOpenAIClient>

type SmokeResult =
  | {
      stage: 'stt'
      sttStatus: number
      sttPayload: Record<string, unknown>
    }
  | {
      stage: 'chat'
      sttPayload: Record<string, unknown>
      chatStatus: number
      chatPayload: Record<string, unknown>
    }
  | {
      stage: 'done'
      sttPayload: Record<string, unknown>
      chatPayload: Record<string, unknown>
      ttsStatus: number
      ttsHeaders: Headers
      ttsByteLength: number
    }

async function runSmokeTurn(turnId: string): Promise<SmokeResult> {
  const sttResponse = await handleSttPost(
    createSttRequest(
      {
        turnId,
        sttLanguageMode: 'strict',
        allowedLanguages: ['ru'],
      },
      createAudioFile(),
    ),
  )

  const sttPayload = await readJson(sttResponse)
  if (sttResponse.status !== 200) {
    return {
      stage: 'stt',
      sttStatus: sttResponse.status,
      sttPayload,
    }
  }

  const transcript = typeof sttPayload.text === 'string' ? sttPayload.text : ''
  const chatResponse = await handleChatPost(
    createJsonRequest('http://localhost/api/chat', {
      conversationId: `conversation-${turnId}`,
      turnId,
      text: transcript,
      personaId: 'Conversational',
    }),
  )

  const chatPayload = await readJson(chatResponse)
  if (chatResponse.status !== 200) {
    return {
      stage: 'chat',
      sttPayload,
      chatStatus: chatResponse.status,
      chatPayload,
    }
  }

  const assistantText = typeof chatPayload.text === 'string' ? chatPayload.text : ''
  const ttsResponse = await handleTtsPost(
    createJsonRequest('http://localhost/api/tts', {
      turnId,
      text: assistantText,
      voice: 'alloy',
    }),
  )

  const ttsBytes = new Uint8Array(await ttsResponse.arrayBuffer())

  return {
    stage: 'done',
    sttPayload,
    chatPayload,
    ttsStatus: ttsResponse.status,
    ttsHeaders: ttsResponse.headers,
    ttsByteLength: ttsBytes.byteLength,
  }
}

describe('smoke turn flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readOpenAIProviderEnv).mockReturnValue({
      apiKey: 'test-key',
      baseURL: 'http://provider.local/v1',
    })
    vi.mocked(readAssistantRuntimeEnv).mockReturnValue({
      conversationMaxDurationSec: null,
      assistantSystemPrompt: null,
      assistantMaxOutputTokens: 220,
    })
  })

  it('completes STT -> CHAT -> TTS pipeline successfully', async () => {
    const callTrace: string[] = []

    const transcribeMock = vi.fn(async (payload: unknown) => {
      const requestPayload = asRecord(payload)
      callTrace.push(`stt:${String(requestPayload.model)}`)
      return {
        text: '  Привет, мир  ',
        language: 'ru',
      }
    })

    const chatMock = vi.fn(async (payload: unknown) => {
      const requestPayload = asRecord(payload)
      callTrace.push(`chat:${String(requestPayload.model)}`)
      return {
        choices: [
          {
            message: {
              content: '  Привет! Чем могу помочь?  ',
            },
          },
        ],
      }
    })

    const speechMock = vi.fn(async (payload: unknown) => {
      const requestPayload = asRecord(payload)
      callTrace.push(`tts:${String(requestPayload.model)}`)
      return {
        arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
      }
    })

    const mockClient = {
      audio: {
        transcriptions: {
          create: transcribeMock,
        },
        speech: {
          create: speechMock,
        },
      },
      chat: {
        completions: {
          create: chatMock,
        },
      },
    }

    vi.mocked(createOpenAIClient).mockReturnValue(mockClient as unknown as OpenAIClient)

    const result = await runSmokeTurn('smoke-ok-1')

    expect(result.stage).toBe('done')
    if (result.stage !== 'done') {
      throw new Error('Expected done stage')
    }

    expect(result.sttPayload.text).toBe('Привет, мир')
    expect(result.chatPayload.text).toBe('Привет! Чем могу помочь?')
    expect(result.ttsStatus).toBe(200)
    expect(result.ttsHeaders.get('content-type')).toBe('audio/mpeg')
    expect(result.ttsHeaders.get('x-turn-id')).toBe('smoke-ok-1')
    expect(result.ttsByteLength).toBe(4)

    expect(transcribeMock).toHaveBeenCalledTimes(1)
    expect(chatMock).toHaveBeenCalledTimes(1)
    expect(speechMock).toHaveBeenCalledTimes(1)
    expect(callTrace).toEqual(['stt:gpt-4o-mini-transcribe', 'chat:gpt-4o-mini', 'tts:tts-1'])
  })

  it('stops the chain when CHAT fails and does not request TTS', async () => {
    const transcribeMock = vi.fn(async () => ({
      text: 'Есть вопрос',
      language: 'ru',
    }))

    const chatMock = vi.fn(async () => {
      const error = new Error('failed to fetch') as Error & { status?: number }
      error.status = 404
      throw error
    })

    const speechMock = vi.fn(async () => ({
      arrayBuffer: async () => Uint8Array.from([9]).buffer,
    }))

    const mockClient = {
      audio: {
        transcriptions: {
          create: transcribeMock,
        },
        speech: {
          create: speechMock,
        },
      },
      chat: {
        completions: {
          create: chatMock,
        },
      },
    }

    vi.mocked(createOpenAIClient).mockReturnValue(mockClient as unknown as OpenAIClient)

    const result = await runSmokeTurn('smoke-fail-chat-1')

    expect(result.stage).toBe('chat')
    if (result.stage !== 'chat') {
      throw new Error('Expected chat failure stage')
    }

    const error = readError(result.chatPayload)
    expect(result.chatStatus).toBe(500)
    expect(error.code).toBe('ProviderUnavailable')
    expect(speechMock).toHaveBeenCalledTimes(0)
  })
})
