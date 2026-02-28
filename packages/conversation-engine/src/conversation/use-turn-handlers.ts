import type { ChatHistoryMessage } from '@conversant/api-contracts'
import { useCallback } from 'react'

import type { PendingUtteranceMeta } from './engine-types'
import { playTtsBlobForTurn } from './tts-playback'
import { requestChatTurn, requestSttTurn, requestTtsTurn } from './turn-api'
import { isTurnStale, settleAbortedTurn } from './turn-guards'
import {
  CHAT_REQUEST_TIMEOUT_MS,
  getChatErrorMessage,
  getSttErrorMessage,
  getTtsErrorMessage,
  isNoSpeechDetectedStt,
  STT_REQUEST_TIMEOUT_MS,
  TTS_REQUEST_TIMEOUT_MS,
} from './turn-pipeline'
import type { TurnRuntime } from './turn-runtime'

const MAX_CLIENT_CHAT_HISTORY_MESSAGES = 24

function hasTextPayload(
  payload: unknown,
): payload is { text: string; latencyMs?: number; detectedLanguage?: string | null } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'text' in payload &&
    typeof (payload as { text?: unknown }).text === 'string' &&
    (payload as { text: string }).text.length > 0
  )
}

export function useTurnHandlers(runtime: TurnRuntime) {
  const runTtsForTurn = useCallback(
    async (turnId: string, text: string, sessionToken: number) => {
      const controller = new AbortController()
      runtime.ttsAbortControllerRef.current = controller

      const timeoutId = window.setTimeout(() => {
        controller.abort('timeout')
      }, TTS_REQUEST_TIMEOUT_MS)

      try {
        const result = await requestTtsTurn({
          turnId,
          text,
          voice: runtime.activeVoiceRef.current,
          signal: controller.signal,
        })

        if (isTurnStale(runtime, turnId, sessionToken)) {
          return
        }

        if (!result.ok) {
          runtime.setLastError(getTtsErrorMessage(result.status, result.errorPayload))
          runtime.setTtsLatencyMs(result.elapsedMs)
          runtime.setCaptureStage('idle')
          runtime.setState(result.status >= 500 ? 'error' : 'listening')
          runtime.clearActiveTurn(turnId)
          return
        }

        if (result.responseTurnId !== turnId) {
          runtime.setLastError('TTS response turn mismatch.')
          runtime.setCaptureStage('idle')
          runtime.setState('error')
          runtime.clearActiveTurn(turnId)
          return
        }

        if (result.blob.size === 0) {
          runtime.setLastError('TTS response is empty.')
          runtime.setCaptureStage('idle')
          runtime.setState('error')
          runtime.clearActiveTurn(turnId)
          return
        }

        runtime.setTtsLatencyMs(result.latencyHeaderMs ?? result.elapsedMs)

        await playTtsBlobForTurn({
          runtime,
          turnId,
          sessionToken,
          blob: result.blob,
        })
      } catch {
        if (isTurnStale(runtime, turnId, sessionToken)) {
          return
        }

        if (controller.signal.aborted) {
          settleAbortedTurn(runtime, turnId)
          return
        }

        runtime.setLastError('Network error during TTS request.')
        runtime.setCaptureStage('idle')
        runtime.setState('error')
        runtime.clearActiveTurn(turnId)
      } finally {
        window.clearTimeout(timeoutId)
        if (runtime.ttsAbortControllerRef.current === controller) {
          runtime.ttsAbortControllerRef.current = null
        }
      }
    },
    [runtime],
  )

  const runChatForTurn = useCallback(
    async (turnId: string, transcript: string, sessionToken: number) => {
      const controller = new AbortController()
      runtime.chatAbortControllerRef.current = controller

      const timeoutId = window.setTimeout(() => {
        controller.abort('timeout')
      }, CHAT_REQUEST_TIMEOUT_MS)

      try {
        const result = await requestChatTurn({
          conversationId: runtime.conversationIdRef.current,
          turnId,
          transcript,
          personaId: runtime.activePersonaRef.current,
          history: runtime.conversationHistoryRef.current,
          signal: controller.signal,
        })

        if (isTurnStale(runtime, turnId, sessionToken)) {
          return
        }

        if (!result.ok) {
          runtime.setLastError(getChatErrorMessage(result.status, result.errorPayload))
          runtime.setLlmLatencyMs(result.elapsedMs)
          runtime.setCaptureStage('idle')
          runtime.setState(result.status >= 500 ? 'error' : 'listening')
          runtime.clearActiveTurn(turnId)
          return
        }

        if (!hasTextPayload(result.payload)) {
          runtime.setLastError('LLM response is invalid.')
          runtime.setCaptureStage('idle')
          runtime.setState('error')
          runtime.clearActiveTurn(turnId)
          return
        }

        runtime.setLastAssistantText(result.payload.text)
        runtime.setLastError(null)
        runtime.setLlmLatencyMs(
          typeof result.payload.latencyMs === 'number' ? result.payload.latencyMs : result.elapsedMs,
        )
        const nextHistory: ChatHistoryMessage[] = [
          ...runtime.conversationHistoryRef.current,
          {
            role: 'user',
            content: transcript,
          },
          {
            role: 'assistant',
            content: result.payload.text,
          },
        ]
        runtime.conversationHistoryRef.current = nextHistory.slice(-MAX_CLIENT_CHAT_HISTORY_MESSAGES)
        runtime.setState('processing')
        runtime.setCaptureStage('finalizing')

        await runTtsForTurn(turnId, result.payload.text, sessionToken)
      } catch {
        if (isTurnStale(runtime, turnId, sessionToken)) {
          return
        }

        if (controller.signal.aborted) {
          settleAbortedTurn(runtime, turnId)
          return
        }

        runtime.setLastError('Network error during chat request.')
        runtime.setCaptureStage('idle')
        runtime.setState('error')
        runtime.clearActiveTurn(turnId)
      } finally {
        window.clearTimeout(timeoutId)
        if (runtime.chatAbortControllerRef.current === controller) {
          runtime.chatAbortControllerRef.current = null
        }
      }
    },
    [runtime, runTtsForTurn],
  )

  const runSttForUtterance = useCallback(
    async (pending: PendingUtteranceMeta, blob: Blob) => {
      const turnId = pending.turnId
      const sessionToken = pending.sessionToken

      runtime.abortTurnRequests()

      const controller = new AbortController()
      runtime.sttAbortControllerRef.current = controller
      runtime.activeTurnIdRef.current = turnId
      runtime.startTurnSoftTimeout(turnId, sessionToken)

      const timeoutId = window.setTimeout(() => {
        controller.abort('timeout')
      }, STT_REQUEST_TIMEOUT_MS)

      runtime.setLastTurnId(turnId)

      const nextLanguageMode = runtime.sttLanguageModeRef.current
      const nextAllowedLanguages = runtime.selectedSttLanguagesRef.current
      if (nextLanguageMode === 'off') {
        runtime.setLastDetectedLanguage('auto')
      } else if (nextAllowedLanguages.length === 1) {
        runtime.setLastDetectedLanguage(nextAllowedLanguages[0])
      } else {
        runtime.setLastDetectedLanguage(null)
      }

      runtime.setSttLatencyMs(null)
      runtime.setLlmLatencyMs(null)
      runtime.setTtsLatencyMs(null)
      runtime.setLastNotice(null)
      runtime.setState('processing')
      runtime.setCaptureStage('finalizing')

      try {
        const result = await requestSttTurn({
          turnId,
          pending,
          blob,
          sttLanguageMode: runtime.sttLanguageModeRef.current,
          allowedLanguages: runtime.selectedSttLanguagesRef.current,
          signal: controller.signal,
        })

        if (isTurnStale(runtime, turnId, sessionToken)) {
          return
        }

        if (!result.ok) {
          const message = getSttErrorMessage(result.status, result.errorPayload)
          if (isNoSpeechDetectedStt(result.status, result.errorPayload)) {
            runtime.setLastNotice(message)
            runtime.setLastError(null)
          } else {
            runtime.setLastNotice(null)
            runtime.setLastError(message)
          }
          runtime.setSttLatencyMs(result.elapsedMs)
          runtime.setCaptureStage('idle')
          runtime.setState(result.status >= 500 ? 'error' : 'listening')
          runtime.clearActiveTurn(turnId)
          return
        }

        if (!hasTextPayload(result.payload)) {
          runtime.setLastNotice(null)
          runtime.setLastError('STT response is invalid.')
          runtime.setState('error')
          runtime.setCaptureStage('idle')
          runtime.clearActiveTurn(turnId)
          return
        }

        runtime.setLastTranscript(result.payload.text)
        runtime.setLastDetectedLanguage(
          typeof result.payload.detectedLanguage === 'string' && result.payload.detectedLanguage.length > 0
            ? result.payload.detectedLanguage
            : null,
        )
        runtime.setLastNotice(null)
        runtime.setLastError(null)
        runtime.setSttLatencyMs(
          typeof result.payload.latencyMs === 'number' ? result.payload.latencyMs : result.elapsedMs,
        )

        await runChatForTurn(turnId, result.payload.text, sessionToken)
      } catch {
        if (isTurnStale(runtime, turnId, sessionToken)) {
          return
        }

        if (controller.signal.aborted) {
          settleAbortedTurn(runtime, turnId)
          return
        }

        runtime.setLastNotice(null)
        runtime.setLastError('Network error during STT request.')
        runtime.setState('error')
        runtime.setCaptureStage('idle')
        runtime.clearActiveTurn(turnId)
      } finally {
        window.clearTimeout(timeoutId)
        if (runtime.sttAbortControllerRef.current === controller) {
          runtime.sttAbortControllerRef.current = null
        }
      }
    },
    [runtime, runChatForTurn],
  )

  return {
    runSttForUtterance,
  }
}
