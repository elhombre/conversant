import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useCallback } from 'react'

import {
  BARGE_IN_ECHO_SUPPRESS_DB,
  BARGE_IN_HOLD_MS,
  BARGE_IN_MIC_BOOST_DB,
  BARGE_IN_PLAYBACK_DELTA_DB,
  calculateDbFromTimeDomain,
  createTurnId,
  MAX_TENTATIVE_CAPTURE_MS,
  PRE_TRIGGER_DB_MARGIN,
} from '@/lib/conversation/audio-io'
import type {
  AudioCtxState,
  CaptureStage,
  ConversationState,
  LastUtterance,
  MicStatus,
  PendingUtteranceMeta,
} from '@/lib/conversation/engine-types'
import type { EnergyVad } from '@/lib/vad/energy-vad'
import { VAD_PRESETS } from '@/lib/vad/presets'
import type { VadEndReason, VadPreset } from '@/lib/vad/types'

type UseCaptureHandlersParams = {
  mediaRecorderRef: RefObject<MediaRecorder | null>
  recorderChunksRef: RefObject<BlobPart[]>
  pendingUtteranceRef: RefObject<PendingUtteranceMeta | null>
  utteranceTokenRef: RefObject<number>
  sessionTokenRef: RefObject<number>
  activePresetRef: RefObject<VadPreset>
  isMutedRef: RefObject<boolean>
  micStatusRef: RefObject<MicStatus>
  contextRef: RefObject<AudioContext | null>
  stateRef: RefObject<ConversationState>
  playbackDbRef: RefObject<number>
  bargeInAboveSinceRef: RefObject<number | null>
  activeTurnIdRef: RefObject<string | null>

  analyserRef: RefObject<AnalyserNode | null>
  sampleBufferRef: RefObject<Uint8Array | null>
  rafRef: RefObject<number | null>
  playbackAnalyserRef: RefObject<AnalyserNode | null>
  playbackSampleBufferRef: RefObject<Uint8Array | null>

  vadRef: RefObject<EnergyVad>

  setCaptureStage: Dispatch<SetStateAction<CaptureStage>>
  setState: Dispatch<SetStateAction<ConversationState>>
  setLastError: Dispatch<SetStateAction<string | null>>
  setLastUtterance: Dispatch<SetStateAction<LastUtterance | null>>
  setInputLevel: Dispatch<SetStateAction<number>>
  setInterruptionCount: Dispatch<SetStateAction<number>>
  setAudioContextState: Dispatch<SetStateAction<AudioCtxState>>

  abortTurnRequests: () => void
  runSttForUtterance: (pending: PendingUtteranceMeta, blob: Blob) => Promise<void>
  stopMeterLoop: () => void
}

export function useCaptureHandlers({
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
}: UseCaptureHandlersParams) {
  const handleRecorderStop = useCallback(() => {
    const pending = pendingUtteranceRef.current
    pendingUtteranceRef.current = null

    if (!pending) {
      setCaptureStage('idle')
      setState('listening')
      return
    }

    if (pending.sessionToken !== sessionTokenRef.current) {
      recorderChunksRef.current = []
      setCaptureStage('idle')
      setState('listening')
      return
    }

    const parts = recorderChunksRef.current
    recorderChunksRef.current = []

    if (pending.silentDiscard || !pending.confirmed) {
      setCaptureStage('idle')
      setState('listening')
      return
    }

    if (!pending.accepted) {
      setCaptureStage('idle')
      setState('listening')
      setLastError('Utterance is too short. Keep speaking a bit longer.')
      return
    }

    if (parts.length === 0) {
      setCaptureStage('idle')
      setState('listening')
      setLastError('No audio data was captured. Try speaking again.')
      return
    }

    const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm'
    const blob = new Blob(parts, { type: mimeType })
    const url = URL.createObjectURL(blob)

    setLastUtterance(previous => {
      if (previous) {
        URL.revokeObjectURL(previous.url)
      }

      return {
        turnId: pending.turnId,
        url,
        mimeType,
        durationMs: pending.durationMs,
        sizeBytes: blob.size,
        reason: pending.reason,
        createdAtMs: Date.now(),
        preset: pending.preset,
      }
    })

    void runSttForUtterance(pending, blob)
  }, [
    mediaRecorderRef,
    pendingUtteranceRef,
    recorderChunksRef,
    runSttForUtterance,
    sessionTokenRef,
    setCaptureStage,
    setLastError,
    setLastUtterance,
    setState,
  ])

  const startSpeechCapture = useCallback(
    (atMs: number, confirmed: boolean) => {
      if (isMutedRef.current) return

      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state !== 'inactive') return

      utteranceTokenRef.current += 1
      recorderChunksRef.current = []
      pendingUtteranceRef.current = {
        token: utteranceTokenRef.current,
        sessionToken: sessionTokenRef.current,
        turnId: createTurnId(),
        preset: activePresetRef.current,
        startMs: atMs,
        endMs: atMs,
        durationMs: 0,
        reason: 'silence',
        accepted: false,
        confirmed,
        silentDiscard: false,
      }

      try {
        if (confirmed) {
          setLastError(null)
          setCaptureStage('speaking')
          setState('user_speaking')
        }
        recorder.start(200)
      } catch {
        pendingUtteranceRef.current = null
        recorderChunksRef.current = []
        if (confirmed) {
          setCaptureStage('idle')
          setState('listening')
          setLastError('Could not start audio capture. Try reconnecting the microphone.')
        }
      }
    },
    [
      activePresetRef,
      isMutedRef,
      mediaRecorderRef,
      pendingUtteranceRef,
      recorderChunksRef,
      sessionTokenRef,
      setCaptureStage,
      setLastError,
      setState,
      utteranceTokenRef,
    ],
  )

  const confirmSpeechCapture = useCallback(
    (atMs: number) => {
      const pending = pendingUtteranceRef.current
      if (pending && !pending.confirmed) {
        pendingUtteranceRef.current = {
          ...pending,
          confirmed: true,
          startMs: Math.min(pending.startMs, atMs),
        }
        setLastError(null)
        setCaptureStage('speaking')
        setState('user_speaking')
        return
      }

      if (!pending) {
        startSpeechCapture(atMs, true)
      }
    },
    [pendingUtteranceRef, setCaptureStage, setLastError, setState, startSpeechCapture],
  )

  const cancelTentativeCapture = useCallback(
    (atMs: number) => {
      const recorder = mediaRecorderRef.current
      const pending = pendingUtteranceRef.current

      if (!pending || pending.confirmed || pending.silentDiscard) {
        return
      }

      pendingUtteranceRef.current = {
        ...pending,
        endMs: atMs,
        durationMs: Math.max(0, atMs - pending.startMs),
        reason: 'silence',
        accepted: false,
        silentDiscard: true,
      }

      if (recorder?.state === 'recording') {
        try {
          recorder.stop()
        } catch {
          pendingUtteranceRef.current = null
          recorderChunksRef.current = []
        }
      }
    },
    [mediaRecorderRef, pendingUtteranceRef, recorderChunksRef],
  )

  const endSpeechCapture = useCallback(
    (atMs: number, durationMs: number, reason: VadEndReason, accepted: boolean) => {
      const recorder = mediaRecorderRef.current
      const pending = pendingUtteranceRef.current

      if (!pending || pending.token !== utteranceTokenRef.current) return

      pendingUtteranceRef.current = {
        ...pending,
        endMs: atMs,
        durationMs,
        reason,
        accepted,
        silentDiscard: false,
      }

      setCaptureStage('finalizing')
      setState('processing')

      if (recorder?.state === 'recording') {
        try {
          recorder.stop()
        } catch {
          setCaptureStage('idle')
          setState('listening')
          setLastError('Could not finalize audio capture. Try again.')
        }
        return
      }

      handleRecorderStop()
    },
    [
      handleRecorderStop,
      mediaRecorderRef,
      pendingUtteranceRef,
      setCaptureStage,
      setLastError,
      setState,
      utteranceTokenRef,
    ],
  )

  const processVadFrame = useCallback(
    (db: number, nowMs: number) => {
      if (isMutedRef.current || micStatusRef.current !== 'ready') {
        return
      }

      const contextState = contextRef.current?.state
      if (contextState && contextState !== 'running') {
        setAudioContextState(contextState)
        return
      }

      const thresholdDb = VAD_PRESETS[activePresetRef.current].thresholdDb
      const isAssistantSpeaking = stateRef.current === 'assistant_speaking'
      if (isAssistantSpeaking) {
        const playbackDb = playbackDbRef.current
        const playbackIsActive = playbackDb > -85
        const micBoostReached = db >= thresholdDb + BARGE_IN_MIC_BOOST_DB
        const playbackDominatesMic = playbackIsActive && playbackDb - db >= BARGE_IN_ECHO_SUPPRESS_DB
        const deltaMatches = db - playbackDb >= BARGE_IN_PLAYBACK_DELTA_DB

        const isLikelyBargeIn = micBoostReached && !playbackDominatesMic && (!playbackIsActive || deltaMatches)

        if (isLikelyBargeIn) {
          if (bargeInAboveSinceRef.current === null) {
            bargeInAboveSinceRef.current = nowMs
            return
          }

          if (nowMs - bargeInAboveSinceRef.current >= BARGE_IN_HOLD_MS) {
            bargeInAboveSinceRef.current = null
            setInterruptionCount(count => count + 1)
            setLastError(null)
            abortTurnRequests()
            vadRef.current.reset()
            vadRef.current.forceSpeechStart(nowMs)
            startSpeechCapture(nowMs, true)
          }
        } else {
          bargeInAboveSinceRef.current = null
        }
        return
      }

      if (activeTurnIdRef.current) {
        return
      }

      const pending = pendingUtteranceRef.current
      const preTriggerDb = thresholdDb - PRE_TRIGGER_DB_MARGIN

      if (!pending && db >= preTriggerDb) {
        startSpeechCapture(nowMs, false)
      } else if (pending && !pending.confirmed && !vadRef.current.isSpeaking()) {
        const exceededTentativeWindow = nowMs - pending.startMs > MAX_TENTATIVE_CAPTURE_MS
        if (db < preTriggerDb || exceededTentativeWindow) {
          cancelTentativeCapture(nowMs)
        }
      }

      const event = vadRef.current.process(db, nowMs)
      if (!event) return

      if (event.type === 'speech_start') {
        confirmSpeechCapture(event.atMs)
        return
      }

      endSpeechCapture(event.atMs, event.durationMs, event.reason, event.accepted)
    },
    [
      abortTurnRequests,
      activePresetRef,
      activeTurnIdRef,
      bargeInAboveSinceRef,
      cancelTentativeCapture,
      confirmSpeechCapture,
      contextRef,
      endSpeechCapture,
      isMutedRef,
      micStatusRef,
      pendingUtteranceRef,
      playbackDbRef,
      setAudioContextState,
      setInterruptionCount,
      setLastError,
      startSpeechCapture,
      stateRef,
      vadRef,
    ],
  )

  const startMeterLoop = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) return

    if (!sampleBufferRef.current || sampleBufferRef.current.length !== analyser.fftSize) {
      sampleBufferRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize))
    }

    const loop = () => {
      const buffer = sampleBufferRef.current
      const meterAnalyser = analyserRef.current
      if (!buffer || !meterAnalyser) return

      meterAnalyser.getByteTimeDomainData(buffer as Uint8Array<ArrayBuffer>)
      const db = calculateDbFromTimeDomain(buffer as Uint8Array<ArrayBuffer>)
      const normalized = Math.max(0, Math.min(1, (db + 60) / 60))

      const playbackAnalyser = playbackAnalyserRef.current
      if (playbackAnalyser) {
        if (!playbackSampleBufferRef.current || playbackSampleBufferRef.current.length !== playbackAnalyser.fftSize) {
          playbackSampleBufferRef.current = new Uint8Array(new ArrayBuffer(playbackAnalyser.fftSize))
        }

        const playbackBuffer = playbackSampleBufferRef.current
        playbackAnalyser.getByteTimeDomainData(playbackBuffer as Uint8Array<ArrayBuffer>)
        playbackDbRef.current = calculateDbFromTimeDomain(playbackBuffer as Uint8Array<ArrayBuffer>)
      } else {
        playbackDbRef.current = -100
      }

      setInputLevel(previous => previous * 0.85 + normalized * 0.15)
      processVadFrame(db, performance.now())

      rafRef.current = requestAnimationFrame(loop)
    }

    stopMeterLoop()
    rafRef.current = requestAnimationFrame(loop)
  }, [
    analyserRef,
    playbackAnalyserRef,
    playbackDbRef,
    playbackSampleBufferRef,
    processVadFrame,
    rafRef,
    sampleBufferRef,
    setInputLevel,
    stopMeterLoop,
  ])

  return {
    handleRecorderStop,
    startMeterLoop,
  }
}
