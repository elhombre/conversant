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

type LastUtterance = {
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
  startMs: number
  endMs: number
  durationMs: number
  reason: VadEndReason
  accepted: boolean
}

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

export default function Home() {
  const [state, setState] = useState<ConversationState>('listening')
  const [captureStage, setCaptureStage] = useState<CaptureStage>('idle')
  const [micStatus, setMicStatus] = useState<MicStatus>('idle')
  const [inputLevel, setInputLevel] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [interruptionCount, setInterruptionCount] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const [activePreset, setActivePreset] = useState<VadPreset>('Normal')
  const [lastUtterance, setLastUtterance] = useState<LastUtterance | null>(null)

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
  const vadRef = useRef(new EnergyVad(VAD_PRESETS.Normal))

  const setPreset = useCallback((preset: VadPreset) => {
    setActivePreset(preset)
    vadRef.current.setConfig(VAD_PRESETS[preset])
  }, [])

  useEffect(() => {
    isMutedRef.current = isMuted
  }, [isMuted])

  useEffect(() => {
    micStatusRef.current = micStatus
  }, [micStatus])

  useEffect(() => {
    activePresetRef.current = activePreset
  }, [activePreset])

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

    vadRef.current.reset()
  }, [stopMeterLoop])

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
        url,
        mimeType,
        durationMs: pending.durationMs,
        sizeBytes: blob.size,
        reason: pending.reason,
        createdAtMs: Date.now(),
        preset: activePresetRef.current,
      }
    })

    setCaptureStage('idle')
    setState('listening')
  }, [])

  const beginSpeechCapture = useCallback((atMs: number) => {
    if (isMutedRef.current) return

    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'inactive') return

    utteranceTokenRef.current += 1
    recorderChunksRef.current = []
    pendingUtteranceRef.current = {
      token: utteranceTokenRef.current,
      sessionToken: sessionTokenRef.current,
      startMs: atMs,
      endMs: atMs,
      durationMs: 0,
      reason: 'silence',
      accepted: false,
    }

    setLastError(null)
    setCaptureStage('speaking')
    setState('user_speaking')
    recorder.start(200)
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
      }

      setCaptureStage('finalizing')
      setState('processing')

      if (recorder?.state === 'recording') {
        recorder.stop()
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

      const event = vadRef.current.process(db, nowMs)
      if (!event) return

      if (event.type === 'speech_start') {
        beginSpeechCapture(event.atMs)
        return
      }

      endSpeechCapture(event.atMs, event.durationMs, event.reason, event.accepted)
    },
    [beginSpeechCapture, endSpeechCapture],
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

      let sumSquares = 0
      for (let i = 0; i < buffer.length; i += 1) {
        const value = (buffer[i] - 128) / 128
        sumSquares += value * value
      }

      const rms = Math.sqrt(sumSquares / buffer.length)
      const db = rms > 0 ? 20 * Math.log10(rms) : -100
      const normalized = Math.max(0, Math.min(1, (db + 60) / 60))

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
          noiseSuppression: true,
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
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
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
    releaseUtteranceUrl()

    if (micStatus === 'ready') {
      setState('listening')
      return
    }

    void initializeMicrophone()
  }, [initializeMicrophone, micStatus, releaseUtteranceUrl])

  const toggleMute = useCallback(() => {
    sessionTokenRef.current += 1
    utteranceTokenRef.current += 1

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
      } else if (micStatus !== 'ready') {
        void initializeMicrophone()
      } else {
        setState('listening')
      }

      return nextMuted
    })
  }, [initializeMicrophone, micStatus, state])

  useEffect(() => {
    void initializeMicrophone()

    return () => {
      sessionTokenRef.current += 1
      utteranceTokenRef.current += 1
      cleanupAudio()
      releaseUtteranceUrl()
    }
  }, [cleanupAudio, initializeMicrophone, releaseUtteranceUrl])

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
          <CardTitle>Conversant - Stage 1 VAD</CardTitle>
          <CardDescription>Energy-based VAD, utterance capture, and debug playback.</CardDescription>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Debug Panel</CardTitle>
            <CardDescription>Latest utterance metadata and local audio playback.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Interruption count</span>
              <span>{interruptionCount}</span>
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
              <p className="text-xs font-medium uppercase text-muted-foreground">Last recording</p>
              {lastUtterance ? (
                // biome-ignore lint/a11y/useMediaCaption: Debug playback for raw user recording has no caption track in stage 1.
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
