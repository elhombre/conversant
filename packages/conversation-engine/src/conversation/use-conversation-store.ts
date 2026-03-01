import { useCallback, useEffect, useMemo } from 'react'
import { VAD_PRESETS } from '../vad/presets'
import type { VadConfig, VadPreset } from '../vad/types'
import { useConversationRuntime } from './use-conversation-runtime'
import { useConversationState } from './use-conversation-state'

function isChromiumFamilyBrowser(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  const userAgent = navigator.userAgent
  return (
    (userAgent.includes('Chrome') || userAgent.includes('CriOS') || userAgent.includes('Edg') || userAgent.includes('OPR')) &&
    !userAgent.includes('Firefox') &&
    !userAgent.includes('FxiOS')
  )
}

export function useConversationStore() {
  const conversationState = useConversationState()
  const isChromiumBrowser = useMemo(() => isChromiumFamilyBrowser(), [])
  const runtime = useConversationRuntime({
    setConversationId: conversationState.setConversationId,
    setState: conversationState.setState,
    setCaptureStage: conversationState.setCaptureStage,
    setMicStatus: conversationState.setMicStatus,
    setAudioContextState: conversationState.setAudioContextState,
    setInputLevel: conversationState.setInputLevel,
    setIsMuted: conversationState.setIsMuted,
    setInterruptionCount: conversationState.setInterruptionCount,
    setLastError: conversationState.setLastError,
    setLastNotice: conversationState.setLastNotice,
    setLastUtterance: conversationState.setLastUtterance,
    setLastTranscript: conversationState.setLastTranscript,
    setLastAssistantText: conversationState.setLastAssistantText,
    setLastTurnId: conversationState.setLastTurnId,
    setLastCompletedTurn: conversationState.setLastCompletedTurn,
    setLastDetectedLanguage: conversationState.setLastDetectedLanguage,
    setSttLatencyMs: conversationState.setSttLatencyMs,
    setLlmLatencyMs: conversationState.setLlmLatencyMs,
    setTtsLatencyMs: conversationState.setTtsLatencyMs,
  })

  useEffect(() => {
    runtime.conversationIdRef.current = conversationState.conversationId
  }, [conversationState.conversationId, runtime.conversationIdRef])

  useEffect(() => {
    runtime.isMutedRef.current = conversationState.isMuted
  }, [conversationState.isMuted, runtime.isMutedRef])

  useEffect(() => {
    runtime.micStatusRef.current = conversationState.micStatus
  }, [conversationState.micStatus, runtime.micStatusRef])

  useEffect(() => {
    runtime.stateRef.current = conversationState.state
    if (conversationState.state !== 'assistant_speaking') {
      runtime.bargeInAboveSinceRef.current = null
    }
  }, [conversationState.state, runtime.bargeInAboveSinceRef, runtime.stateRef])

  useEffect(() => {
    runtime.sttLanguageModeRef.current = conversationState.sttLanguageMode
  }, [conversationState.sttLanguageMode, runtime.sttLanguageModeRef])

  useEffect(() => {
    runtime.selectedSttLanguagesRef.current = conversationState.selectedSttLanguages
  }, [conversationState.selectedSttLanguages, runtime.selectedSttLanguagesRef])

  const resolveVadConfig = useCallback(
    (preset: VadPreset): VadConfig => {
      const base = VAD_PRESETS[preset]
      if (!isChromiumBrowser) {
        return base
      }

      return {
        ...base,
        thresholdDb: base.thresholdDb - 2,
        endThresholdOffsetDb: 2,
        endDropFromPeakDb: 10,
        startHoldMs: Math.max(50, Math.round(base.startHoldMs * 0.7)),
        endHoldMs: Math.max(220, Math.round(base.endHoldMs * 0.6)),
      }
    },
    [isChromiumBrowser],
  )

  useEffect(() => {
    runtime.vadRef.current.setConfig(resolveVadConfig(conversationState.activePreset))
  }, [conversationState.activePreset, resolveVadConfig, runtime.vadRef])

  const setPreset = useCallback(
    (preset: VadPreset) => {
      conversationState.setActivePreset(preset)
      runtime.activePresetRef.current = preset
      runtime.vadRef.current.setConfig(resolveVadConfig(preset))
    },
    [conversationState.setActivePreset, resolveVadConfig, runtime.activePresetRef, runtime.vadRef],
  )

  const setPersona = useCallback(
    (personaId: (typeof conversationState)['activePersona']) => {
      conversationState.setActivePersona(personaId)
      runtime.activePersonaRef.current = personaId
    },
    [conversationState.setActivePersona, runtime.activePersonaRef],
  )

  const setVoice = useCallback(
    (voice: (typeof conversationState)['activeVoice']) => {
      conversationState.setActiveVoice(voice)
      runtime.activeVoiceRef.current = voice
    },
    [conversationState.setActiveVoice, runtime.activeVoiceRef],
  )

  return {
    ...conversationState,
    ...runtime,
    setPreset,
    setPersona,
    setVoice,
  }
}
