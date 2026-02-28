import { useCallback, useEffect } from 'react'

import { useConversationRuntime } from '@/lib/conversation/use-conversation-runtime'
import { useConversationState } from '@/lib/conversation/use-conversation-state'
import { VAD_PRESETS } from '@/lib/vad/presets'
import type { VadPreset } from '@/lib/vad/types'

export function useConversationStore() {
  const conversationState = useConversationState()
  const runtime = useConversationRuntime({
    setState: conversationState.setState,
    setCaptureStage: conversationState.setCaptureStage,
    setMicStatus: conversationState.setMicStatus,
    setAudioContextState: conversationState.setAudioContextState,
    setInputLevel: conversationState.setInputLevel,
    setIsMuted: conversationState.setIsMuted,
    setInterruptionCount: conversationState.setInterruptionCount,
    setLastError: conversationState.setLastError,
    setLastUtterance: conversationState.setLastUtterance,
    setLastTranscript: conversationState.setLastTranscript,
    setLastAssistantText: conversationState.setLastAssistantText,
    setLastTurnId: conversationState.setLastTurnId,
    setLastDetectedLanguage: conversationState.setLastDetectedLanguage,
    setSttLatencyMs: conversationState.setSttLatencyMs,
    setLlmLatencyMs: conversationState.setLlmLatencyMs,
    setTtsLatencyMs: conversationState.setTtsLatencyMs,
  })

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

  const setPreset = useCallback(
    (preset: VadPreset) => {
      conversationState.setActivePreset(preset)
      runtime.activePresetRef.current = preset
      runtime.vadRef.current.setConfig(VAD_PRESETS[preset])
    },
    [conversationState.setActivePreset, runtime.activePresetRef, runtime.vadRef],
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
