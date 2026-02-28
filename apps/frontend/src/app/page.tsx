'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EnergyVad } from '@/lib/vad/energy-vad'
import { VAD_PRESET_ORDER, VAD_PRESETS } from '@/lib/vad/presets'
import type { VadConfig, VadEndReason, VadPreset } from '@/lib/vad/types'

type ConversationState = 'listening' | 'user_speaking' | 'processing' | 'assistant_speaking' | 'error'
type MicStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'error'
type CaptureStage = 'idle' | 'speaking' | 'finalizing'
type AudioCtxState = AudioContextState | 'uninitialized'
type PersonaId = 'Concise' | 'Conversational' | 'Interviewer'
type VoiceId = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'
type SttLanguageCode = 'en' | 'ru' | 'es' | 'de' | 'fr' | 'it' | 'pt' | 'tr' | 'uk' | 'pl'
type SttLanguageMode = 'off' | 'strict'

type SttErrorCode =
  | 'BadAudioFormat'
  | 'PayloadTooLarge'
  | 'UnsupportedLanguage'
  | 'NoSpeechDetected'
  | 'Timeout'
  | 'Cancelled'
  | 'ProviderUnavailable'
  | 'InternalError'

type SttSuccessPayload = {
  turnId: string
  text: string
  detectedLanguage?: string | null
  latencyMs?: number
}

type SttErrorPayload = {
  turnId?: string | null
  error?: {
    code?: string
    message?: string
  }
}

type ChatErrorCode = 'BadRequest' | 'Timeout' | 'Cancelled' | 'ProviderUnavailable' | 'InternalError'

type ChatSuccessPayload = {
  turnId: string
  text: string
  personaId?: PersonaId
  latencyMs?: number
}

type ChatErrorPayload = {
  turnId?: string | null
  error?: {
    code?: string
    message?: string
  }
}

type TtsErrorCode = 'BadRequest' | 'Timeout' | 'Cancelled' | 'ProviderUnavailable' | 'InternalError'

type TtsErrorPayload = {
  turnId?: string | null
  error?: {
    code?: string
    message?: string
  }
}

type LastUtterance = {
  turnId: string
  url: string
  mimeType: string
  durationMs: number
  sizeBytes: number
  reason: VadEndReason
  createdAtMs: number
  preset: VadPreset
}

type PendingUtteranceMeta = {
  token: number
  sessionToken: number
  turnId: string
  preset: VadPreset
  startMs: number
  endMs: number
  durationMs: number
  reason: VadEndReason
  accepted: boolean
  confirmed: boolean
  silentDiscard: boolean
}

const PERSONA_ORDER: PersonaId[] = ['Concise', 'Conversational', 'Interviewer']
const VOICE_ORDER: VoiceId[] = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
const STT_LANGUAGE_ORDER: SttLanguageCode[] = ['en', 'ru', 'es', 'de', 'fr', 'it', 'pt', 'tr', 'uk', 'pl']
const STT_LANGUAGE_LABELS: Record<SttLanguageCode, string> = {
  en: 'English',
  ru: 'Russian',
  es: 'Spanish',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  pt: 'Portuguese',
  tr: 'Turkish',
  uk: 'Ukrainian',
  pl: 'Polish',
}
const PRE_TRIGGER_DB_MARGIN = 10
const MAX_TENTATIVE_CAPTURE_MS = 1_200
const BARGE_IN_MIC_BOOST_DB = 2
const BARGE_IN_PLAYBACK_DELTA_DB = -6
const BARGE_IN_ECHO_SUPPRESS_DB = 10
const BARGE_IN_HOLD_MS = 90

function pickRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return null

  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType
    }
  }

  return ''
}

function createTurnId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `turn-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`
}

function calculateDbFromTimeDomain(buffer: Uint8Array<ArrayBuffer>): number {
  let sumSquares = 0
  for (let i = 0; i < buffer.length; i += 1) {
    const value = (buffer[i] - 128) / 128
    sumSquares += value * value
  }

  const rms = Math.sqrt(sumSquares / buffer.length)
  return rms > 0 ? 20 * Math.log10(rms) : -100
}

function getSttErrorMessage(status: number, payload: SttErrorPayload | null) {
  const defaultMessages: Record<SttErrorCode, string> = {
    BadAudioFormat: 'Invalid audio format or payload.',
    PayloadTooLarge: 'Audio payload is too large.',
    UnsupportedLanguage: 'Detected language is outside the selected language set.',
    NoSpeechDetected: 'No speech detected. Try speaking a bit longer.',
    Timeout: 'STT request timed out. Please retry.',
    Cancelled: 'STT request was cancelled.',
    ProviderUnavailable: 'STT provider is unavailable right now.',
    InternalError: 'Unexpected STT error occurred.',
  }

  const code = payload?.error?.code
  const message = payload?.error?.message

  if (typeof message === 'string' && message.length > 0) {
    return message
  }

  if (typeof code === 'string' && code in defaultMessages) {
    return defaultMessages[code as SttErrorCode]
  }

  if (status >= 500) {
    return defaultMessages.ProviderUnavailable
  }

  if (status === 422) {
    return defaultMessages.NoSpeechDetected
  }

  return defaultMessages.InternalError
}

function getChatErrorMessage(status: number, payload: ChatErrorPayload | null) {
  const defaultMessages: Record<ChatErrorCode, string> = {
    BadRequest: 'Invalid chat payload.',
    Timeout: 'LLM request timed out. Please retry.',
    Cancelled: 'Chat request was cancelled.',
    ProviderUnavailable: 'LLM provider is unavailable right now.',
    InternalError: 'Unexpected LLM error occurred.',
  }

  const code = payload?.error?.code
  const message = payload?.error?.message

  if (typeof message === 'string' && message.length > 0) {
    return message
  }

  if (typeof code === 'string' && code in defaultMessages) {
    return defaultMessages[code as ChatErrorCode]
  }

  if (status >= 500) {
    return defaultMessages.ProviderUnavailable
  }

  return defaultMessages.InternalError
}

function getTtsErrorMessage(status: number, payload: TtsErrorPayload | null) {
  const defaultMessages: Record<TtsErrorCode, string> = {
    BadRequest: 'Invalid TTS payload.',
    Timeout: 'TTS request timed out. Please retry.',
    Cancelled: 'TTS request was cancelled.',
    ProviderUnavailable: 'TTS provider is unavailable right now.',
    InternalError: 'Unexpected TTS error occurred.',
  }

  const code = payload?.error?.code
  const message = payload?.error?.message

  if (typeof message === 'string' && message.length > 0) {
    return message
  }

  if (typeof code === 'string' && code in defaultMessages) {
    return defaultMessages[code as TtsErrorCode]
  }

  if (status >= 500) {
    return defaultMessages.ProviderUnavailable
  }

  return defaultMessages.InternalError
}

export default function Home() {
  const [state, setState] = useState<ConversationState>('listening')
  const [captureStage, setCaptureStage] = useState<CaptureStage>('idle')
  const [micStatus, setMicStatus] = useState<MicStatus>('idle')
  const [audioContextState, setAudioContextState] = useState<AudioCtxState>('uninitialized')
  const [inputLevel, setInputLevel] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [interruptionCount, setInterruptionCount] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const [activePreset, setActivePreset] = useState<VadPreset>('Normal')
  const [activePersona, setActivePersona] = useState<PersonaId>('Conversational')
  const [activeVoice, setActiveVoice] = useState<VoiceId>('alloy')
  const [sttLanguageMode, setSttLanguageMode] = useState<SttLanguageMode>('off')
  const [selectedSttLanguages, setSelectedSttLanguages] = useState<SttLanguageCode[]>(['en', 'ru'])
  const [lastUtterance, setLastUtterance] = useState<LastUtterance | null>(null)
  const [lastTranscript, setLastTranscript] = useState('')
  const [lastAssistantText, setLastAssistantText] = useState('')
  const [lastTurnId, setLastTurnId] = useState('')
  const [lastDetectedLanguage, setLastDetectedLanguage] = useState<string | null>(null)
  const [sttLatencyMs, setSttLatencyMs] = useState<number | null>(null)
  const [llmLatencyMs, setLlmLatencyMs] = useState<number | null>(null)
  const [ttsLatencyMs, setTtsLatencyMs] = useState<number | null>(null)

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
  const activeTurnIdRef = useRef<string | null>(null)
  const vadRef = useRef(new EnergyVad(VAD_PRESETS.Normal))

  const setPreset = useCallback((preset: VadPreset) => {
    setActivePreset(preset)
    activePresetRef.current = preset
    vadRef.current.setConfig(VAD_PRESETS[preset])
  }, [])

  const setPersona = useCallback((personaId: PersonaId) => {
    setActivePersona(personaId)
    activePersonaRef.current = personaId
  }, [])

  const setVoice = useCallback((voice: VoiceId) => {
    setActiveVoice(voice)
    activeVoiceRef.current = voice
  }, [])

  const toggleSttLanguageMode = useCallback(() => {
    setSttLanguageMode(previous => (previous === 'off' ? 'strict' : 'off'))
  }, [])

  const toggleSttLanguage = useCallback((language: SttLanguageCode) => {
    setSelectedSttLanguages(previous => {
      if (previous.includes(language)) {
        if (previous.length === 1) {
          return previous
        }
        return previous.filter(entry => entry !== language)
      }

      return [...previous, language]
    })
  }, [])

  useEffect(() => {
    isMutedRef.current = isMuted
  }, [isMuted])

  useEffect(() => {
    micStatusRef.current = micStatus
  }, [micStatus])

  useEffect(() => {
    stateRef.current = state
    if (state !== 'assistant_speaking') {
      bargeInAboveSinceRef.current = null
    }
  }, [state])

  useEffect(() => {
    sttLanguageModeRef.current = sttLanguageMode
  }, [sttLanguageMode])

  useEffect(() => {
    selectedSttLanguagesRef.current = selectedSttLanguages
  }, [selectedSttLanguages])

  const clearActiveTurn = useCallback((turnId: string) => {
    if (activeTurnIdRef.current === turnId) {
      activeTurnIdRef.current = null
    }
  }, [])

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

    stopPlayback()
    activeTurnIdRef.current = null
  }, [stopPlayback])

  const releaseUtteranceUrl = useCallback(() => {
    setLastUtterance(previous => {
      if (previous) {
        URL.revokeObjectURL(previous.url)
      }
      return null
    })
  }, [])

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
  }, [stopMeterLoop, stopPlayback])

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
  }, [])

  const runTtsForTurn = useCallback(
    async (turnId: string, text: string, sessionToken: number) => {
      const controller = new AbortController()
      ttsAbortControllerRef.current = controller

      const timeoutId = window.setTimeout(() => {
        controller.abort('timeout')
      }, 15_000)

      try {
        const startedAt = performance.now()
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            turnId,
            text,
            voice: activeVoiceRef.current,
          }),
          signal: controller.signal,
        })

        const elapsedMs = Math.round(performance.now() - startedAt)
        const stale = sessionTokenRef.current !== sessionToken || activeTurnIdRef.current !== turnId
        if (stale) {
          return
        }

        if (!response.ok) {
          const isJson = response.headers.get('content-type')?.includes('application/json') ?? false
          const payload: unknown = isJson ? await response.json() : null
          const errorPayload = payload && typeof payload === 'object' ? (payload as TtsErrorPayload) : null
          setLastError(getTtsErrorMessage(response.status, errorPayload))
          setTtsLatencyMs(elapsedMs)
          setCaptureStage('idle')

          if (response.status >= 500) {
            setState('error')
          } else {
            setState('listening')
          }

          clearActiveTurn(turnId)
          return
        }

        const responseTurnId = response.headers.get('x-turn-id')
        if (responseTurnId !== turnId) {
          setLastError('TTS response turn mismatch.')
          setCaptureStage('idle')
          setState('error')
          clearActiveTurn(turnId)
          return
        }

        const blob = await response.blob()
        if (blob.size === 0) {
          setLastError('TTS response is empty.')
          setCaptureStage('idle')
          setState('error')
          clearActiveTurn(turnId)
          return
        }

        const latencyHeader = response.headers.get('x-tts-latency-ms')
        const latencyFromHeader =
          typeof latencyHeader === 'string' && latencyHeader.length > 0 ? Number.parseInt(latencyHeader, 10) : NaN
        setTtsLatencyMs(Number.isFinite(latencyFromHeader) ? latencyFromHeader : elapsedMs)

        stopPlayback()

        const currentContext = contextRef.current
        if (currentContext) {
          if (currentContext.state === 'suspended') {
            await currentContext.resume()
            setAudioContextState(currentContext.state)
          }

          if (currentContext.state === 'running') {
            try {
              const rawBuffer = await blob.arrayBuffer()
              const decodedBuffer = await currentContext.decodeAudioData(rawBuffer.slice(0))

              const staleAfterDecode = sessionTokenRef.current !== sessionToken || activeTurnIdRef.current !== turnId
              if (staleAfterDecode) {
                return
              }

              const source = currentContext.createBufferSource()
              source.buffer = decodedBuffer
              const playbackAnalyser = currentContext.createAnalyser()
              playbackAnalyser.fftSize = 1024
              playbackAnalyser.smoothingTimeConstant = 0.8

              source.connect(playbackAnalyser)
              playbackAnalyser.connect(currentContext.destination)

              playbackSourceRef.current = source
              playbackAnalyserRef.current = playbackAnalyser
              playbackSampleBufferRef.current = null
              playbackDbRef.current = -100

              const finalizePlayback = (nextState: ConversationState, message: string | null) => {
                stopPlayback()

                const stillSameTurn = sessionTokenRef.current === sessionToken && activeTurnIdRef.current === turnId
                if (!stillSameTurn) {
                  return
                }

                setCaptureStage('idle')
                setLastError(message)
                setState(nextState)
                clearActiveTurn(turnId)
              }

              source.onended = () => {
                finalizePlayback('listening', null)
              }

              setState('assistant_speaking')
              setCaptureStage('idle')
              source.start(0)
              return
            } catch {
              // Fallback below to HTMLAudioElement playback if WebAudio decode fails.
            }
          }
        }

        const audioUrl = URL.createObjectURL(blob)
        const audio = new Audio(audioUrl)
        audio.preload = 'auto'

        playbackAudioRef.current = audio
        playbackAudioUrlRef.current = audioUrl
        playbackDbRef.current = -100

        const fallbackContext = contextRef.current
        if (fallbackContext && fallbackContext.state === 'running') {
          try {
            const mediaSource = fallbackContext.createMediaElementSource(audio)
            const playbackAnalyser = fallbackContext.createAnalyser()
            playbackAnalyser.fftSize = 1024
            playbackAnalyser.smoothingTimeConstant = 0.8

            mediaSource.connect(playbackAnalyser)
            playbackAnalyser.connect(fallbackContext.destination)

            playbackMediaSourceRef.current = mediaSource
            playbackAnalyserRef.current = playbackAnalyser
            playbackSampleBufferRef.current = null
          } catch {
            playbackMediaSourceRef.current = null
            playbackAnalyserRef.current = null
            playbackSampleBufferRef.current = null
          }
        }

        const finalizePlayback = (nextState: ConversationState, message: string | null) => {
          stopPlayback()

          const stillSameTurn = sessionTokenRef.current === sessionToken && activeTurnIdRef.current === turnId
          if (!stillSameTurn) {
            return
          }

          setCaptureStage('idle')
          setLastError(message)
          setState(nextState)
          clearActiveTurn(turnId)
        }

        audio.onended = () => {
          finalizePlayback('listening', null)
        }

        audio.onerror = () => {
          finalizePlayback('error', 'Playback failed. Check browser audio output settings.')
        }

        setState('assistant_speaking')
        setCaptureStage('idle')

        try {
          await audio.play()
        } catch {
          finalizePlayback(
            'listening',
            'Playback was blocked by browser autoplay policy. Interact with the page and retry.',
          )
        }
      } catch {
        const stale = sessionTokenRef.current !== sessionToken || activeTurnIdRef.current !== turnId
        if (stale) {
          return
        }

        if (controller.signal.aborted) {
          setCaptureStage('idle')
          if (!isMutedRef.current) {
            setState('listening')
          }
          clearActiveTurn(turnId)
          return
        }

        setLastError('Network error during TTS request.')
        setCaptureStage('idle')
        setState('error')
        clearActiveTurn(turnId)
      } finally {
        window.clearTimeout(timeoutId)
        if (ttsAbortControllerRef.current === controller) {
          ttsAbortControllerRef.current = null
        }
      }
    },
    [clearActiveTurn, stopPlayback],
  )

  const runChatForTurn = useCallback(
    async (turnId: string, transcript: string, sessionToken: number) => {
      const controller = new AbortController()
      chatAbortControllerRef.current = controller

      const timeoutId = window.setTimeout(() => {
        controller.abort('timeout')
      }, 15_000)

      try {
        const startedAt = performance.now()
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            turnId,
            text: transcript,
            personaId: activePersonaRef.current,
          }),
          signal: controller.signal,
        })

        const elapsedMs = Math.round(performance.now() - startedAt)
        const isJson = response.headers.get('content-type')?.includes('application/json') ?? false
        const payload: unknown = isJson ? await response.json() : null

        const stale = sessionTokenRef.current !== sessionToken || activeTurnIdRef.current !== turnId
        if (stale) {
          return
        }

        if (!response.ok) {
          const errorPayload = payload && typeof payload === 'object' ? (payload as ChatErrorPayload) : null
          setLastError(getChatErrorMessage(response.status, errorPayload))
          setLlmLatencyMs(elapsedMs)
          setCaptureStage('idle')

          if (response.status >= 500) {
            setState('error')
          } else {
            setState('listening')
          }

          clearActiveTurn(turnId)
          return
        }

        const successPayload = payload && typeof payload === 'object' ? (payload as ChatSuccessPayload) : null
        if (!successPayload || typeof successPayload.text !== 'string' || successPayload.text.length === 0) {
          setLastError('LLM response is invalid.')
          setCaptureStage('idle')
          setState('error')
          clearActiveTurn(turnId)
          return
        }

        setLastAssistantText(successPayload.text)
        setLastError(null)
        setLlmLatencyMs(typeof successPayload.latencyMs === 'number' ? successPayload.latencyMs : elapsedMs)
        setState('processing')
        setCaptureStage('finalizing')

        await runTtsForTurn(turnId, successPayload.text, sessionToken)
      } catch {
        const stale = sessionTokenRef.current !== sessionToken || activeTurnIdRef.current !== turnId
        if (stale) {
          return
        }

        if (controller.signal.aborted) {
          setCaptureStage('idle')
          if (!isMutedRef.current) {
            setState('listening')
          }
          clearActiveTurn(turnId)
          return
        }

        setLastError('Network error during chat request.')
        setCaptureStage('idle')
        setState('error')
        clearActiveTurn(turnId)
      } finally {
        window.clearTimeout(timeoutId)
        if (chatAbortControllerRef.current === controller) {
          chatAbortControllerRef.current = null
        }
      }
    },
    [clearActiveTurn, runTtsForTurn],
  )

  const runSttForUtterance = useCallback(
    async (pending: PendingUtteranceMeta, blob: Blob) => {
      const turnId = pending.turnId
      const sessionToken = pending.sessionToken

      abortTurnRequests()

      const controller = new AbortController()
      sttAbortControllerRef.current = controller
      activeTurnIdRef.current = turnId

      const timeoutId = window.setTimeout(() => {
        controller.abort('timeout')
      }, 12_000)

      setLastTurnId(turnId)
      const nextLanguageMode = sttLanguageModeRef.current
      const nextAllowedLanguages = selectedSttLanguagesRef.current
      if (nextLanguageMode === 'off') {
        setLastDetectedLanguage('auto')
      } else if (nextAllowedLanguages.length === 1) {
        setLastDetectedLanguage(nextAllowedLanguages[0])
      } else {
        setLastDetectedLanguage(null)
      }
      setSttLatencyMs(null)
      setLlmLatencyMs(null)
      setTtsLatencyMs(null)
      setState('processing')
      setCaptureStage('finalizing')

      try {
        const formData = new FormData()
        const fileName = `utterance-${turnId}.webm`
        const fileType = blob.type.length > 0 ? blob.type : 'audio/webm'
        const audioFile = new File([blob], fileName, { type: fileType })

        formData.append('audio', audioFile)
        formData.append(
          'meta',
          JSON.stringify({
            turnId,
            preset: pending.preset,
            durationMs: pending.durationMs,
            sttLanguageMode: sttLanguageModeRef.current,
            allowedLanguages: selectedSttLanguagesRef.current,
          }),
        )

        const startedAt = performance.now()
        const response = await fetch('/api/stt', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        })

        const elapsedMs = Math.round(performance.now() - startedAt)
        const isJson = response.headers.get('content-type')?.includes('application/json') ?? false
        const payload: unknown = isJson ? await response.json() : null

        const stale = sessionTokenRef.current !== sessionToken || activeTurnIdRef.current !== turnId
        if (stale) {
          return
        }

        if (!response.ok) {
          const errorPayload = payload && typeof payload === 'object' ? (payload as SttErrorPayload) : null
          setLastError(getSttErrorMessage(response.status, errorPayload))
          setSttLatencyMs(elapsedMs)
          setCaptureStage('idle')

          if (response.status >= 500) {
            setState('error')
          } else {
            setState('listening')
          }

          clearActiveTurn(turnId)
          return
        }

        const successPayload = payload && typeof payload === 'object' ? (payload as SttSuccessPayload) : null
        if (!successPayload || typeof successPayload.text !== 'string' || successPayload.text.length === 0) {
          setLastError('STT response is invalid.')
          setState('error')
          setCaptureStage('idle')
          clearActiveTurn(turnId)
          return
        }

        setLastTranscript(successPayload.text)
        setLastDetectedLanguage(
          typeof successPayload.detectedLanguage === 'string' && successPayload.detectedLanguage.length > 0
            ? successPayload.detectedLanguage
            : null,
        )
        setLastError(null)
        setSttLatencyMs(typeof successPayload.latencyMs === 'number' ? successPayload.latencyMs : elapsedMs)

        await runChatForTurn(turnId, successPayload.text, sessionToken)
      } catch {
        const stale = sessionTokenRef.current !== sessionToken || activeTurnIdRef.current !== turnId
        if (stale) {
          return
        }

        if (controller.signal.aborted) {
          setCaptureStage('idle')
          if (!isMutedRef.current) {
            setState('listening')
          }
          clearActiveTurn(turnId)
          return
        }

        setLastError('Network error during STT request.')
        setState('error')
        setCaptureStage('idle')
        clearActiveTurn(turnId)
      } finally {
        window.clearTimeout(timeoutId)

        if (sttAbortControllerRef.current === controller) {
          sttAbortControllerRef.current = null
        }
      }
    },
    [abortTurnRequests, clearActiveTurn, runChatForTurn],
  )

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
  }, [runSttForUtterance])

  const startSpeechCapture = useCallback((atMs: number, confirmed: boolean) => {
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
  }, [])

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
    [startSpeechCapture],
  )

  const cancelTentativeCapture = useCallback((atMs: number) => {
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
  }, [])

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
    [handleRecorderStop],
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
    [abortTurnRequests, cancelTentativeCapture, confirmSpeechCapture, endSpeechCapture, startSpeechCapture],
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
  }, [processVadFrame, stopMeterLoop])

  const initializeMicrophone = useCallback(async () => {
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
  }, [cleanupAudio, handleRecorderStop, startMeterLoop])

  const resetSession = useCallback(() => {
    sessionTokenRef.current += 1
    utteranceTokenRef.current += 1

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
  }, [abortTurnRequests, initializeMicrophone, releaseUtteranceUrl])

  const toggleMute = useCallback(() => {
    sessionTokenRef.current += 1
    utteranceTokenRef.current += 1

    abortTurnRequests()

    setIsMuted(previous => {
      const nextMuted = !previous

      if (nextMuted) {
        if (state !== 'listening') {
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
  }, [abortTurnRequests, initializeMicrophone, state])

  useEffect(() => {
    void initializeMicrophone()

    return () => {
      sessionTokenRef.current += 1
      utteranceTokenRef.current += 1
      abortTurnRequests()
      cleanupAudio()
      releaseUtteranceUrl()
    }
  }, [abortTurnRequests, cleanupAudio, initializeMicrophone, releaseUtteranceUrl])

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

  const stateVariant = useMemo(() => {
    if (state === 'error') return 'destructive'
    if (state === 'processing') return 'secondary'
    if (state === 'assistant_speaking') return 'outline'
    return 'default'
  }, [state])

  const micVariant = useMemo(() => {
    if (micStatus === 'ready') return 'default'
    if (micStatus === 'requesting') return 'secondary'
    if (micStatus === 'denied' || micStatus === 'error') return 'destructive'
    return 'outline'
  }, [micStatus])

  const captureVariant = useMemo(() => {
    if (captureStage === 'speaking') return 'default'
    if (captureStage === 'finalizing') return 'secondary'
    return 'outline'
  }, [captureStage])

  const activeConfig: VadConfig = VAD_PRESETS[activePreset]
  const visibleLevel = isMuted ? 0 : inputLevel

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 p-4 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Conversant - Stage 4 TTS</CardTitle>
          <CardDescription>VAD capture, STT, LLM response, TTS synthesis, and playback.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge className="w-[170px] justify-center font-mono" variant={stateVariant}>
            state: {state}
          </Badge>
          <Badge className="w-[170px] justify-center font-mono" variant={micVariant}>
            mic: {micStatus}
          </Badge>
          <Badge className="w-[170px] justify-center font-mono" variant={isMuted ? 'destructive' : 'outline'}>
            mode: {isMuted ? 'muted' : 'active'}
          </Badge>
          <Badge className="w-[170px] justify-center font-mono" variant={captureVariant}>
            capture: {captureStage}
          </Badge>
          <Badge className="w-[170px] justify-center font-mono" variant="outline">
            audio: {audioContextState}
          </Badge>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Session Controls</CardTitle>
            <CardDescription>Stable controls for session and microphone behavior.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button className="w-full" onClick={resetSession} variant="outline">
                Reset Session
              </Button>
              <Button className="w-full" onClick={toggleMute} variant={isMuted ? 'secondary' : 'destructive'}>
                Mute / Resume
              </Button>
              <Button className="w-full" disabled={isMuted || micStatus !== 'ready'} onClick={releaseUtteranceUrl}>
                Clear Recording
              </Button>
              <Button
                className="w-full"
                onClick={() => {
                  void resumeAudioContext()
                  void initializeMicrophone()
                }}
                variant="secondary"
              >
                Reconnect Mic
              </Button>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Input level</p>
              <div className="h-2 w-full rounded bg-muted">
                <div
                  className="h-2 rounded bg-primary transition-[width] duration-150"
                  style={{ width: `${Math.round(visibleLevel * 100)}%` }}
                />
              </div>
              <p className="w-24 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(visibleLevel * 100)}% {isMuted ? '(muted)' : ''}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">VAD preset</p>
              <div className="grid grid-cols-3 gap-2">
                {VAD_PRESET_ORDER.map(preset => (
                  <Button
                    className="w-full"
                    key={preset}
                    onClick={() => setPreset(preset)}
                    size="sm"
                    variant={activePreset === preset ? 'default' : 'outline'}
                  >
                    {preset}
                  </Button>
                ))}
              </div>
              <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                threshold: {activeConfig.thresholdDb} dB | startHold: {activeConfig.startHoldMs} ms | endHold:{' '}
                {activeConfig.endHoldMs} ms
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">STT languages</p>
              <Button
                className="w-full"
                onClick={toggleSttLanguageMode}
                variant={sttLanguageMode === 'strict' ? 'default' : 'outline'}
              >
                Language filter: {sttLanguageMode === 'strict' ? 'strict' : 'off (faster)'}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                {STT_LANGUAGE_ORDER.map(language => (
                  <Button
                    className="w-full justify-start"
                    key={language}
                    onClick={() => toggleSttLanguage(language)}
                    size="sm"
                    variant={selectedSttLanguages.includes(language) ? 'secondary' : 'outline'}
                  >
                    {STT_LANGUAGE_LABELS[language]} ({language})
                  </Button>
                ))}
              </div>
              <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                {sttLanguageMode === 'strict'
                  ? `Strict mode: only selected languages are accepted (${selectedSttLanguages.length} selected).`
                  : 'Off mode: no language restriction, fastest STT path.'}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Persona</p>
              <div className="grid grid-cols-3 gap-2">
                {PERSONA_ORDER.map(personaId => (
                  <Button
                    className="w-full"
                    key={personaId}
                    onClick={() => setPersona(personaId)}
                    size="sm"
                    variant={activePersona === personaId ? 'default' : 'outline'}
                  >
                    {personaId}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Voice</p>
              <div className="grid grid-cols-3 gap-2">
                {VOICE_ORDER.map(voice => (
                  <Button
                    className="w-full"
                    key={voice}
                    onClick={() => setVoice(voice)}
                    size="sm"
                    variant={activeVoice === voice ? 'default' : 'outline'}
                  >
                    {voice}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Debug Panel</CardTitle>
            <CardDescription>Utterance metadata, transcript, and LLM response diagnostics.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Interruption count</span>
              <span>{interruptionCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Last turn id</span>
              <span className="max-w-[200px] truncate font-mono text-xs">{lastTurnId || '--'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">STT ms</span>
              <span>{sttLatencyMs ?? '--'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">LLM ms</span>
              <span>{llmLatencyMs ?? '--'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">TTS ms</span>
              <span>{ttsLatencyMs ?? '--'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Voice</span>
              <span>{activeVoice}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">STT lang mode</span>
              <span>{sttLanguageMode}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">STT langs</span>
              <span className="max-w-[200px] truncate">{selectedSttLanguages.join(', ')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Detected language</span>
              <span>{lastDetectedLanguage ?? '--'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Audio context</span>
              <span>{audioContextState}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Last duration</span>
              <span>{lastUtterance ? `${lastUtterance.durationMs} ms` : '--'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Last size</span>
              <span>{lastUtterance ? `${Math.round(lastUtterance.sizeBytes / 1024)} KB` : '--'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Capture reason</span>
              <span>{lastUtterance?.reason ?? '--'}</span>
            </div>

            <div className="space-y-1 rounded border bg-muted/30 p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Transcript (runtime)</p>
              <p>{lastTranscript || '--'}</p>
            </div>

            <div className="space-y-1 rounded border bg-muted/30 p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Assistant text (runtime)</p>
              <p>{lastAssistantText || '--'}</p>
            </div>

            <div className="space-y-1 rounded border bg-muted/30 p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Last recording</p>
              {lastUtterance ? (
                // biome-ignore lint/a11y/useMediaCaption: Debug playback for raw user recording has no caption track.
                <audio className="w-full" controls preload="metadata" src={lastUtterance.url} />
              ) : (
                <p className="text-muted-foreground">No utterance captured yet.</p>
              )}
            </div>

            {lastError ? (
              <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                {lastError}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
