'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { VAD_PRESETS } from '../vad/presets'
import type { VadConfig } from '../vad/types'
import { requestResetConversation } from './turn-api'
import type { TurnRuntime } from './turn-runtime'
import { useCaptureHandlers } from './use-capture-handlers'
import { useConversationStore } from './use-conversation-store'
import { useConversationVariants } from './use-conversation-variants'
import { useTurnHandlers } from './use-turn-handlers'

export type UseConversationEngineOptions = {
  onConversationExpired?: (conversationId: string) => void
}

export function useConversationEngine(options: UseConversationEngineOptions = {}) {
  const {
    conversationId,
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
    lastNotice,
    setLastNotice,
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
    conversationIdRef,
    conversationHistoryRef,
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
      conversationIdRef,
      conversationHistoryRef,
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
      setLastNotice,
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
      onConversationExpired: options.onConversationExpired,
    }),
    [
      activeTurnIdRef,
      conversationIdRef,
      conversationHistoryRef,
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
      setLastNotice,
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
      options.onConversationExpired,
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
    const previousConversationId = conversationIdRef.current
    resetSessionWithInitializer(initializeMicrophone)
    void requestResetConversation(previousConversationId)
  }, [conversationIdRef, initializeMicrophone, resetSessionWithInitializer])

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
    conversationId,
    captureStage,
    micStatus,
    audioContextState,
    analyserNode: analyserRef.current,
    inputLevel,
    isMuted,
    interruptionCount,
    lastError,
    lastNotice,
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
