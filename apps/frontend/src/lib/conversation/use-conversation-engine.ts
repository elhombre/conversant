'use client'

import { useCallback, useEffect, useMemo } from 'react'
import type { TurnRuntime } from '@/lib/conversation/turn-runtime'
import { useCaptureHandlers } from '@/lib/conversation/use-capture-handlers'
import { useConversationStore } from '@/lib/conversation/use-conversation-store'
import { useConversationVariants } from '@/lib/conversation/use-conversation-variants'
import { useTurnHandlers } from '@/lib/conversation/use-turn-handlers'
import { VAD_PRESETS } from '@/lib/vad/presets'
import type { VadConfig } from '@/lib/vad/types'

export function useConversationEngine() {
  const {
    state,
    setState,
    captureStage,
    setCaptureStage,
    micStatus,
    audioContextState,
    setAudioContextState,
    inputLevel,
    setInputLevel,
    isMuted,
    interruptionCount,
    setInterruptionCount,
    lastError,
    setLastError,
    activePreset,
    activePersona,
    activeVoice,
    sttLanguageMode,
    selectedSttLanguages,
    lastUtterance,
    setLastUtterance,
    lastTranscript,
    setLastTranscript,
    lastAssistantText,
    setLastAssistantText,
    lastTurnId,
    setLastTurnId,
    lastDetectedLanguage,
    setLastDetectedLanguage,
    sttLatencyMs,
    setSttLatencyMs,
    llmLatencyMs,
    setLlmLatencyMs,
    ttsLatencyMs,
    setTtsLatencyMs,
    contextRef,
    analyserRef,
    rafRef,
    sampleBufferRef,
    mediaRecorderRef,
    recorderChunksRef,
    pendingUtteranceRef,
    utteranceTokenRef,
    sessionTokenRef,
    isMutedRef,
    micStatusRef,
    activePresetRef,
    activePersonaRef,
    activeVoiceRef,
    sttLanguageModeRef,
    selectedSttLanguagesRef,
    sttAbortControllerRef,
    chatAbortControllerRef,
    ttsAbortControllerRef,
    playbackSourceRef,
    playbackAnalyserRef,
    playbackMediaSourceRef,
    playbackAudioRef,
    playbackAudioUrlRef,
    playbackSampleBufferRef,
    playbackDbRef,
    stateRef,
    bargeInAboveSinceRef,
    activeTurnIdRef,
    vadRef,
    setPreset,
    setPersona,
    setVoice,
    toggleSttLanguageMode,
    toggleSttLanguage,
    clearActiveTurn,
    stopPlayback,
    abortTurnRequests,
    startTurnSoftTimeout,
    releaseUtteranceUrl,
    stopMeterLoop,
    cleanupAudio,
    resumeAudioContext,
    initializeMicrophoneWithHandlers,
    resetSessionWithInitializer,
    toggleMuteWithInitializer,
    reconnectMicrophoneWithInitializer,
  } = useConversationStore()

  const turnRuntime: TurnRuntime = useMemo(
    () => ({
      activeTurnIdRef,
      activeVoiceRef,
      activePersonaRef,
      sessionTokenRef,
      isMutedRef,
      contextRef,
      sttLanguageModeRef,
      selectedSttLanguagesRef,
      sttAbortControllerRef,
      chatAbortControllerRef,
      ttsAbortControllerRef,
      playbackSourceRef,
      playbackAnalyserRef,
      playbackMediaSourceRef,
      playbackAudioRef,
      playbackAudioUrlRef,
      playbackSampleBufferRef,
      playbackDbRef,
      setState,
      setCaptureStage,
      setLastError,
      setLastTranscript,
      setLastAssistantText,
      setLastTurnId,
      setLastDetectedLanguage,
      setSttLatencyMs,
      setLlmLatencyMs,
      setTtsLatencyMs,
      setAudioContextState,
      stopPlayback,
      clearActiveTurn,
      abortTurnRequests,
      startTurnSoftTimeout,
    }),
    [
      activeTurnIdRef,
      activeVoiceRef,
      activePersonaRef,
      sessionTokenRef,
      isMutedRef,
      contextRef,
      sttLanguageModeRef,
      selectedSttLanguagesRef,
      sttAbortControllerRef,
      chatAbortControllerRef,
      ttsAbortControllerRef,
      playbackSourceRef,
      playbackAnalyserRef,
      playbackMediaSourceRef,
      playbackAudioRef,
      playbackAudioUrlRef,
      playbackSampleBufferRef,
      playbackDbRef,
      setState,
      setCaptureStage,
      setLastError,
      setLastTranscript,
      setLastAssistantText,
      setLastTurnId,
      setLastDetectedLanguage,
      setSttLatencyMs,
      setLlmLatencyMs,
      setTtsLatencyMs,
      setAudioContextState,
      stopPlayback,
      clearActiveTurn,
      abortTurnRequests,
      startTurnSoftTimeout,
    ],
  )

  const { runSttForUtterance } = useTurnHandlers(turnRuntime)

  const { handleRecorderStop, startMeterLoop } = useCaptureHandlers({
    mediaRecorderRef,
    recorderChunksRef,
    pendingUtteranceRef,
    utteranceTokenRef,
    sessionTokenRef,
    activePresetRef,
    isMutedRef,
    micStatusRef,
    contextRef,
    stateRef,
    playbackDbRef,
    bargeInAboveSinceRef,
    activeTurnIdRef,
    analyserRef,
    sampleBufferRef,
    rafRef,
    playbackAnalyserRef,
    playbackSampleBufferRef,
    vadRef,
    setCaptureStage,
    setState,
    setLastError,
    setLastUtterance,
    setInputLevel,
    setInterruptionCount,
    setAudioContextState,
    abortTurnRequests,
    runSttForUtterance,
    stopMeterLoop,
  })

  const initializeMicrophone = useCallback(
    () =>
      initializeMicrophoneWithHandlers({
        handleRecorderStop,
        startMeterLoop,
      }),
    [handleRecorderStop, initializeMicrophoneWithHandlers, startMeterLoop],
  )

  const resetSession = useCallback(() => {
    resetSessionWithInitializer(initializeMicrophone)
  }, [initializeMicrophone, resetSessionWithInitializer])

  const toggleMute = useCallback(() => {
    toggleMuteWithInitializer(initializeMicrophone)
  }, [initializeMicrophone, toggleMuteWithInitializer])

  const reconnectMicrophone = useCallback(() => {
    reconnectMicrophoneWithInitializer(initializeMicrophone)
  }, [initializeMicrophone, reconnectMicrophoneWithInitializer])

  useEffect(() => {
    void initializeMicrophone()

    return () => {
      sessionTokenRef.current += 1
      utteranceTokenRef.current += 1
      abortTurnRequests()
      cleanupAudio()
      releaseUtteranceUrl()
    }
  }, [abortTurnRequests, cleanupAudio, initializeMicrophone, releaseUtteranceUrl, sessionTokenRef, utteranceTokenRef])

  useEffect(() => {
    const onUserInteract = () => {
      void resumeAudioContext()
    }

    window.addEventListener('pointerdown', onUserInteract, { passive: true })
    window.addEventListener('keydown', onUserInteract)

    return () => {
      window.removeEventListener('pointerdown', onUserInteract)
      window.removeEventListener('keydown', onUserInteract)
    }
  }, [resumeAudioContext])

  const { stateVariant, micVariant, captureVariant } = useConversationVariants({
    state,
    micStatus,
    captureStage,
  })

  const activeConfig: VadConfig = VAD_PRESETS[activePreset]
  const visibleLevel = isMuted ? 0 : inputLevel

  return {
    state,
    captureStage,
    micStatus,
    audioContextState,
    inputLevel,
    isMuted,
    interruptionCount,
    lastError,
    activePreset,
    activePersona,
    activeVoice,
    sttLanguageMode,
    selectedSttLanguages,
    lastUtterance,
    lastTranscript,
    lastAssistantText,
    lastTurnId,
    lastDetectedLanguage,
    sttLatencyMs,
    llmLatencyMs,
    ttsLatencyMs,
    stateVariant,
    micVariant,
    captureVariant,
    activeConfig,
    visibleLevel,
    setPreset,
    setPersona,
    setVoice,
    toggleSttLanguageMode,
    toggleSttLanguage,
    resetSession,
    toggleMute,
    releaseUtteranceUrl,
    reconnectMicrophone,
  }
}
