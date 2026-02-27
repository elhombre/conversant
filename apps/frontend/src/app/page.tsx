'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type ConversationState = 'listening' | 'user_speaking' | 'processing' | 'assistant_speaking' | 'error'

type ProcessingStage = 'stt' | 'llm' | 'tts' | null

type MicStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'error'

type TurnMetrics = {
  sttMs: number | null
  llmMs: number | null
  ttsMs: number | null
  totalMs: number | null
}

const EMPTY_METRICS: TurnMetrics = {
  sttMs: null,
  llmMs: null,
  ttsMs: null,
  totalMs: null,
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export default function Home() {
  const [state, setState] = useState<ConversationState>('listening')
  const [processingStage, setProcessingStage] = useState<ProcessingStage>(null)
  const [micStatus, setMicStatus] = useState<MicStatus>('idle')
  const [inputLevel, setInputLevel] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [interruptionCount, setInterruptionCount] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const [lastUserText, setLastUserText] = useState('')
  const [lastAssistantText, setLastAssistantText] = useState('')
  const [turnMetrics, setTurnMetrics] = useState<TurnMetrics>(EMPTY_METRICS)

  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const sampleBufferRef = useRef<Uint8Array | null>(null)
  const simulationTokenRef = useRef(0)
  const isMutedRef = useRef(false)
  const micRequestInFlightRef = useRef(false)

  const resetMeasurements = useCallback(() => {
    setTurnMetrics(EMPTY_METRICS)
    setLastUserText('')
    setLastAssistantText('')
    setLastError(null)
    setProcessingStage(null)
  }, [])

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const cleanupAudio = useCallback(() => {
    stopLoop()

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
  }, [stopLoop])

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

      setInputLevel(previous => previous * 0.75 + normalized * 0.25)
      rafRef.current = requestAnimationFrame(loop)
    }

    stopLoop()
    rafRef.current = requestAnimationFrame(loop)
  }, [stopLoop])

  useEffect(() => {
    isMutedRef.current = isMuted
  }, [isMuted])

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
      if (!isMutedRef.current) {
        setState('listening')
      }
      startMeterLoop()
    } catch (error) {
      const err = error as DOMException
      const isPermissionError = err?.name === 'NotAllowedError' || err?.name === 'SecurityError'

      setMicStatus(isPermissionError ? 'denied' : 'error')
      setState('error')
      setLastError(
        isPermissionError
          ? 'Microphone access was denied. Grant access and retry.'
          : 'Could not initialize microphone input.',
      )
    } finally {
      micRequestInFlightRef.current = false
    }
  }, [cleanupAudio, startMeterLoop])

  const resetSession = useCallback(() => {
    simulationTokenRef.current += 1

    setIsMuted(false)
    setInterruptionCount(0)
    setInputLevel(0)
    resetMeasurements()

    if (micStatus === 'ready') {
      setState('listening')
      return
    }

    void initializeMicrophone()
  }, [initializeMicrophone, micStatus, resetMeasurements])

  const toggleMute = useCallback(() => {
    simulationTokenRef.current += 1

    setIsMuted(previous => {
      const nextMuted = !previous

      if (nextMuted) {
        if (state !== 'listening') {
          setInterruptionCount(count => count + 1)
        }
        setState('listening')
        setProcessingStage(null)
        setInputLevel(0)
      } else {
        if (micStatus === 'ready') {
          setState('listening')
        } else {
          void initializeMicrophone()
        }
      }

      return nextMuted
    })
  }, [initializeMicrophone, micStatus, state])

  const simulateTurn = useCallback(async () => {
    if (micStatus !== 'ready' || isMuted) return

    simulationTokenRef.current += 1
    const token = simulationTokenRef.current
    const startedAt = performance.now()

    setLastError(null)
    setState('user_speaking')
    setLastUserText('Draft user transcript appears in runtime UI.')

    await wait(450)
    if (simulationTokenRef.current !== token || isMuted) return

    setState('processing')

    const sttStart = performance.now()
    setProcessingStage('stt')
    await wait(500)
    if (simulationTokenRef.current !== token || isMuted) return
    const sttMs = Math.round(performance.now() - sttStart)

    const llmStart = performance.now()
    setProcessingStage('llm')
    await wait(550)
    if (simulationTokenRef.current !== token || isMuted) return
    const llmMs = Math.round(performance.now() - llmStart)

    const ttsStart = performance.now()
    setLastAssistantText('Assistant text appears before audio to reduce perceived latency.')
    setProcessingStage('tts')
    await wait(600)
    if (simulationTokenRef.current !== token || isMuted) return
    const ttsMs = Math.round(performance.now() - ttsStart)

    setTurnMetrics({
      sttMs,
      llmMs,
      ttsMs,
      totalMs: Math.round(performance.now() - startedAt),
    })

    setProcessingStage(null)
    setState('assistant_speaking')

    await wait(900)
    if (simulationTokenRef.current !== token || isMuted) return

    setState('listening')
  }, [isMuted, micStatus])

  useEffect(() => {
    void initializeMicrophone()

    return () => {
      simulationTokenRef.current += 1
      cleanupAudio()
    }
  }, [cleanupAudio, initializeMicrophone])

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

  const visibleLevel = isMuted ? 0 : inputLevel

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 p-4 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Conversant - Stage 0 Shell</CardTitle>
          <CardDescription>Baseline runtime UI for FSM, microphone level, and session controls.</CardDescription>
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
          <Badge className="w-[170px] justify-center font-mono" variant="secondary">
            stage: {processingStage ?? '---'}
          </Badge>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Session Controls</CardTitle>
            <CardDescription>Reset and pause/resume controls for the baseline loop.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Button className="w-full" onClick={resetSession} variant="outline">
                Reset Session
              </Button>
              <Button className="w-full" onClick={toggleMute} variant={isMuted ? 'secondary' : 'destructive'}>
                Mute / Resume
              </Button>
              <Button className="w-full" disabled={isMuted || micStatus !== 'ready'} onClick={simulateTurn}>
                Simulate Turn
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
                  className="h-2 rounded bg-primary transition-[width] duration-100"
                  style={{ width: `${Math.round(visibleLevel * 100)}%` }}
                />
              </div>
              <p className="w-24 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(visibleLevel * 100)}% {isMuted ? '(muted)' : ''}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Debug Panel</CardTitle>
            <CardDescription>State, metrics, and runtime text for local testing.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Interruption count</span>
              <span>{interruptionCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">STT ms</span>
              <span>{turnMetrics.sttMs ?? '--'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">LLM ms</span>
              <span>{turnMetrics.llmMs ?? '--'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">TTS ms</span>
              <span>{turnMetrics.ttsMs ?? '--'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total ms</span>
              <span>{turnMetrics.totalMs ?? '--'}</span>
            </div>

            <div className="space-y-1 rounded border bg-muted/30 p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">User text (runtime)</p>
              <p>{lastUserText || '--'}</p>
            </div>

            <div className="space-y-1 rounded border bg-muted/30 p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Assistant text (runtime)</p>
              <p>{lastAssistantText || '--'}</p>
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
