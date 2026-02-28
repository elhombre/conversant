import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useRef } from 'react'
import { EnergyVad } from '../vad/energy-vad'
import { VAD_PRESETS } from '../vad/presets'
import type { VadPreset } from '../vad/types'
import { createConversationId, pickRecorderMimeType } from './audio-io'
import type {
  AudioCtxState,
  CaptureStage,
  ConversationState,
  LastUtterance,
  MicStatus,
  PendingUtteranceMeta,
  PersonaId,
  SttLanguageCode,
  SttLanguageMode,
  VoiceId,
} from './engine-types'
import { TOTAL_TURN_SOFT_TIMEOUT_MS } from './turn-pipeline'

type CaptureCallbacks = {
  handleRecorderStop: () => void
  startMeterLoop: () => void
}

type UseConversationRuntimeParams = {
  setConversationId: Dispatch<SetStateAction<string>>
  setState: Dispatch<SetStateAction<ConversationState>>
  setCaptureStage: Dispatch<SetStateAction<CaptureStage>>
  setMicStatus: Dispatch<SetStateAction<MicStatus>>
  setAudioContextState: Dispatch<SetStateAction<AudioCtxState>>
  setInputLevel: Dispatch<SetStateAction<number>>
  setIsMuted: Dispatch<SetStateAction<boolean>>
  setInterruptionCount: Dispatch<SetStateAction<number>>
  setLastError: Dispatch<SetStateAction<string | null>>
  setLastUtterance: Dispatch<SetStateAction<LastUtterance | null>>
  setLastTranscript: Dispatch<SetStateAction<string>>
  setLastAssistantText: Dispatch<SetStateAction<string>>
  setLastTurnId: Dispatch<SetStateAction<string>>
  setLastDetectedLanguage: Dispatch<SetStateAction<string | null>>
  setSttLatencyMs: Dispatch<SetStateAction<number | null>>
  setLlmLatencyMs: Dispatch<SetStateAction<number | null>>
  setTtsLatencyMs: Dispatch<SetStateAction<number | null>>
}

export function useConversationRuntime({
  setConversationId,
  setState,
  setCaptureStage,
  setMicStatus,
  setAudioContextState,
  setInputLevel,
  setIsMuted,
  setInterruptionCount,
  setLastError,
  setLastUtterance,
  setLastTranscript,
  setLastAssistantText,
  setLastTurnId,
  setLastDetectedLanguage,
  setSttLatencyMs,
  setLlmLatencyMs,
  setTtsLatencyMs,
}: UseConversationRuntimeParams) {
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const sampleBufferRef = useRef<Uint8Array | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recorderChunksRef = useRef<BlobPart[]>([])
  const pendingUtteranceRef = useRef<PendingUtteranceMeta | null>(null)
  const utteranceTokenRef = useRef(0)
  const sessionTokenRef = useRef(0)
  const conversationIdRef = useRef('')
  const micRequestInFlightRef = useRef(false)
  const isMutedRef = useRef(false)
  const micStatusRef = useRef<MicStatus>('idle')
  const activePresetRef = useRef<VadPreset>('Normal')
  const activePersonaRef = useRef<PersonaId>('Conversational')
  const activeVoiceRef = useRef<VoiceId>('alloy')
  const sttLanguageModeRef = useRef<SttLanguageMode>('off')
  const selectedSttLanguagesRef = useRef<SttLanguageCode[]>(['en', 'ru'])
  const sttAbortControllerRef = useRef<AbortController | null>(null)
  const chatAbortControllerRef = useRef<AbortController | null>(null)
  const ttsAbortControllerRef = useRef<AbortController | null>(null)
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null)
  const playbackMediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null)
  const playbackAudioUrlRef = useRef<string | null>(null)
  const playbackSampleBufferRef = useRef<Uint8Array | null>(null)
  const playbackDbRef = useRef(-100)
  const stateRef = useRef<ConversationState>('listening')
  const bargeInAboveSinceRef = useRef<number | null>(null)
  const turnSoftTimeoutRef = useRef<number | null>(null)
  const activeTurnIdRef = useRef<string | null>(null)
  const vadRef = useRef(new EnergyVad(VAD_PRESETS.Normal))

  const clearTurnSoftTimeout = useCallback(() => {
    const timeoutId = turnSoftTimeoutRef.current
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
      turnSoftTimeoutRef.current = null
    }
  }, [])

  const clearActiveTurn = useCallback(
    (turnId: string) => {
      if (activeTurnIdRef.current === turnId) {
        activeTurnIdRef.current = null
        clearTurnSoftTimeout()
      }
    },
    [clearTurnSoftTimeout],
  )

  const stopPlayback = useCallback(() => {
    const source = playbackSourceRef.current
    if (source) {
      source.onended = null
      try {
        source.stop()
      } catch {
        // no-op: source may already be stopped
      }
      source.disconnect()
      playbackSourceRef.current = null
    }

    const playbackAnalyser = playbackAnalyserRef.current
    if (playbackAnalyser) {
      playbackAnalyser.disconnect()
      playbackAnalyserRef.current = null
    }

    const playbackMediaSource = playbackMediaSourceRef.current
    if (playbackMediaSource) {
      playbackMediaSource.disconnect()
      playbackMediaSourceRef.current = null
    }

    const audio = playbackAudioRef.current
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.currentTime = 0
      playbackAudioRef.current = null
    }

    const audioUrl = playbackAudioUrlRef.current
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
      playbackAudioUrlRef.current = null
    }

    playbackSampleBufferRef.current = null
    playbackDbRef.current = -100
  }, [])

  const abortTurnRequests = useCallback(() => {
    const sttController = sttAbortControllerRef.current
    if (sttController) {
      sttController.abort()
      sttAbortControllerRef.current = null
    }

    const chatController = chatAbortControllerRef.current
    if (chatController) {
      chatController.abort()
      chatAbortControllerRef.current = null
    }

    const ttsController = ttsAbortControllerRef.current
    if (ttsController) {
      ttsController.abort()
      ttsAbortControllerRef.current = null
    }

    clearTurnSoftTimeout()
    stopPlayback()
    activeTurnIdRef.current = null
  }, [clearTurnSoftTimeout, stopPlayback])

  const startTurnSoftTimeout = useCallback(
    (turnId: string, sessionToken: number) => {
      clearTurnSoftTimeout()
      turnSoftTimeoutRef.current = window.setTimeout(() => {
        const stale = sessionTokenRef.current !== sessionToken || activeTurnIdRef.current !== turnId
        if (stale) {
          return
        }

        setLastError('Turn timed out. Please retry.')
        setCaptureStage('idle')
        setState('error')
        abortTurnRequests()
      }, TOTAL_TURN_SOFT_TIMEOUT_MS)
    },
    [abortTurnRequests, clearTurnSoftTimeout, setCaptureStage, setLastError, setState],
  )

  const releaseUtteranceUrl = useCallback(() => {
    setLastUtterance(previous => {
      if (previous) {
        URL.revokeObjectURL(previous.url)
      }
      return null
    })
  }, [setLastUtterance])

  const stopMeterLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const cleanupAudio = useCallback(() => {
    stopMeterLoop()

    const recorder = mediaRecorderRef.current
    if (recorder?.state === 'recording') {
      recorder.stop()
    }

    mediaRecorderRef.current = null
    recorderChunksRef.current = []
    pendingUtteranceRef.current = null

    sourceRef.current?.disconnect()
    sourceRef.current = null
    analyserRef.current = null
    sampleBufferRef.current = null

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }

    if (contextRef.current) {
      void contextRef.current.close()
      contextRef.current = null
    }
    setAudioContextState('uninitialized')
    stopPlayback()

    vadRef.current.reset()
  }, [setAudioContextState, stopMeterLoop, stopPlayback])

  const resumeAudioContext = useCallback(async () => {
    const context = contextRef.current
    if (!context) return

    setAudioContextState(context.state)
    if (context.state === 'running' || context.state === 'closed') {
      return
    }

    try {
      await context.resume()
      setAudioContextState(context.state)
    } catch {
      setAudioContextState(context.state)
    }
  }, [setAudioContextState])

  const initializeMicrophoneWithHandlers = useCallback(
    async ({ handleRecorderStop, startMeterLoop }: CaptureCallbacks) => {
      if (micRequestInFlightRef.current) return

      micRequestInFlightRef.current = true
      setMicStatus('requesting')
      setLastError(null)

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: false,
          },
        })

        cleanupAudio()

        if (typeof MediaRecorder === 'undefined') {
          throw new Error('MediaRecorder API is unavailable in this browser')
        }

        const recorderMimeType = pickRecorderMimeType()
        const recorder = recorderMimeType
          ? new MediaRecorder(stream, { mimeType: recorderMimeType })
          : new MediaRecorder(stream)

        recorder.ondataavailable = event => {
          if (event.data.size > 0) {
            recorderChunksRef.current.push(event.data)
          }
        }

        recorder.onstop = () => {
          handleRecorderStop()
        }

        mediaRecorderRef.current = recorder

        const audioContext = new AudioContext()
        setAudioContextState(audioContext.state)
        audioContext.onstatechange = () => {
          setAudioContextState(audioContext.state)
        }

        if (audioContext.state === 'suspended') {
          await audioContext.resume()
          setAudioContextState(audioContext.state)
        }

        const source = audioContext.createMediaStreamSource(stream)
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 2048
        analyser.smoothingTimeConstant = 0.8
        source.connect(analyser)

        streamRef.current = stream
        contextRef.current = audioContext
        sourceRef.current = source
        analyserRef.current = analyser

        setMicStatus('ready')
        setCaptureStage('idle')
        if (!isMutedRef.current) {
          setState('listening')
        }
        startMeterLoop()
      } catch (error) {
        const err = error as DOMException
        const isPermissionError = err?.name === 'NotAllowedError' || err?.name === 'SecurityError'

        setMicStatus(isPermissionError ? 'denied' : 'error')
        setCaptureStage('idle')
        setState('error')
        setLastError(
          isPermissionError
            ? 'Microphone access was denied. Grant access and retry.'
            : 'Could not initialize microphone input.',
        )
      } finally {
        micRequestInFlightRef.current = false
      }
    },
    [cleanupAudio, setAudioContextState, setCaptureStage, setLastError, setMicStatus, setState],
  )

  const resetSessionWithInitializer = useCallback(
    (initializeMicrophone: () => Promise<void>) => {
      sessionTokenRef.current += 1
      utteranceTokenRef.current += 1
      const nextConversationId = createConversationId()
      conversationIdRef.current = nextConversationId
      setConversationId(nextConversationId)

      abortTurnRequests()

      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop()
      }

      recorderChunksRef.current = []
      pendingUtteranceRef.current = null
      vadRef.current.reset()

      setIsMuted(false)
      setInterruptionCount(0)
      setInputLevel(0)
      setCaptureStage('idle')
      setLastError(null)
      setLastTranscript('')
      setLastAssistantText('')
      setLastTurnId('')
      setLastDetectedLanguage(null)
      setSttLatencyMs(null)
      setLlmLatencyMs(null)
      setTtsLatencyMs(null)
      releaseUtteranceUrl()

      if (micStatusRef.current === 'ready') {
        setState('listening')
        return
      }

      void initializeMicrophone()
    },
    [
      abortTurnRequests,
      releaseUtteranceUrl,
      setConversationId,
      setCaptureStage,
      setInputLevel,
      setInterruptionCount,
      setIsMuted,
      setLastAssistantText,
      setLastDetectedLanguage,
      setLastError,
      setLastTranscript,
      setLastTurnId,
      setLlmLatencyMs,
      setState,
      setSttLatencyMs,
      setTtsLatencyMs,
    ],
  )

  const toggleMuteWithInitializer = useCallback(
    (initializeMicrophone: () => Promise<void>) => {
      sessionTokenRef.current += 1
      utteranceTokenRef.current += 1

      abortTurnRequests()

      setIsMuted(previous => {
        const nextMuted = !previous

        if (nextMuted) {
          if (stateRef.current !== 'listening') {
            setInterruptionCount(count => count + 1)
          }

          if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.stop()
          }

          recorderChunksRef.current = []
          pendingUtteranceRef.current = null
          vadRef.current.reset()

          setState('listening')
          setCaptureStage('idle')
          setInputLevel(0)
        } else if (micStatusRef.current !== 'ready') {
          void initializeMicrophone()
        } else {
          setState('listening')
        }

        return nextMuted
      })
    },
    [abortTurnRequests, setCaptureStage, setInputLevel, setInterruptionCount, setIsMuted, setState],
  )

  const reconnectMicrophoneWithInitializer = useCallback(
    (initializeMicrophone: () => Promise<void>) => {
      void resumeAudioContext()
      void initializeMicrophone()
    },
    [resumeAudioContext],
  )

  return {
    streamRef,
    contextRef,
    analyserRef,
    sourceRef,
    rafRef,
    sampleBufferRef,
    mediaRecorderRef,
    recorderChunksRef,
    pendingUtteranceRef,
    utteranceTokenRef,
    sessionTokenRef,
    conversationIdRef,
    micRequestInFlightRef,
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
    turnSoftTimeoutRef,
    activeTurnIdRef,
    vadRef,
    clearTurnSoftTimeout,
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
  }
}
