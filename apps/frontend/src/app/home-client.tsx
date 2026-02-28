'use client'

import type { ConversationState, MicStatus } from '@conversant/conversation-engine'
import {
  PERSONA_ORDER,
  STT_LANGUAGE_LABELS,
  STT_LANGUAGE_ORDER,
  useConversationEngine,
  VAD_PRESET_ORDER,
  VOICE_ORDER,
} from '@conversant/conversation-engine'
import { MessageCircleCheck, Settings, Speech } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import AudioOscilloscopeVisualizer from '@/components/audio/audio-oscilloscope-visualizer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type SectionId = 'conversation' | 'messages' | 'settings'
type FeedRole = 'user' | 'assistant'

type FeedMessage = {
  id: string
  role: FeedRole
  text: string
  turnId: string
  createdAtMs: number
}

type SectionConfig = {
  id: SectionId
  label: string
  icon: typeof Speech
}

const SECTIONS: SectionConfig[] = [
  {
    id: 'conversation',
    label: 'Беседа',
    icon: Speech,
  },
  {
    id: 'messages',
    label: 'Сообщения',
    icon: MessageCircleCheck,
  },
  {
    id: 'settings',
    label: 'Настройки',
    icon: Settings,
  },
]

function formatDuration(seconds: number): string {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const remainSeconds = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainSeconds).padStart(2, '0')}`
}

function formatClockTime(timestampMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestampMs))
}

function resolveConversationStateLabel(state: ConversationState): string {
  switch (state) {
    case 'assistant_speaking':
      return 'Speaking'
    case 'processing':
      return 'Processing'
    case 'user_speaking':
      return 'Listening'
    case 'error':
      return 'Error'
    case 'listening':
      return 'Ready'
  }
}

function resolveMicStatusLabel(status: MicStatus): string {
  switch (status) {
    case 'ready':
      return 'Connected'
    case 'requesting':
      return 'Requesting'
    case 'denied':
      return 'Denied'
    case 'error':
      return 'Error'
    case 'idle':
      return 'Idle'
  }
}

function resolveStateBadgeVariant(state: ConversationState): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'error') {
    return 'destructive'
  }
  if (state === 'assistant_speaking') {
    return 'secondary'
  }
  if (state === 'processing') {
    return 'outline'
  }

  return 'default'
}

function resolveFeedRoleLabel(role: FeedRole): string {
  return role === 'assistant' ? 'Assistant' : 'You'
}

export function HomeClient() {
  const router = useRouter()
  const [activeSection, setActiveSection] = useState<SectionId>('conversation')
  const [elapsedSec, setElapsedSec] = useState(0)
  const [feedMessages, setFeedMessages] = useState<FeedMessage[]>([])
  const appendedTurnIdsRef = useRef<Set<string>>(new Set())
  const conversationFeedScrollRef = useRef<HTMLDivElement | null>(null)

  const handleConversationExpired = useCallback(
    (conversationId: string) => {
      router.replace(`/conversation-ended/${encodeURIComponent(conversationId)}`)
    },
    [router],
  )

  const {
    state,
    captureStage,
    micStatus,
    isMuted,
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
    sttLatencyMs,
    llmLatencyMs,
    ttsLatencyMs,
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
    conversationId,
    analyserNode,
  } = useConversationEngine({
    onConversationExpired: handleConversationExpired,
  })

  useEffect(() => {
    if (!conversationId) {
      return
    }

    setElapsedSec(0)
    const startedAt = Date.now()
    const timerId = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [conversationId])

  useEffect(() => {
    if (!conversationId) {
      return
    }

    setFeedMessages([])
    appendedTurnIdsRef.current.clear()
  }, [conversationId])

  useEffect(() => {
    if (!lastTurnId || !lastTranscript || !lastAssistantText) {
      return
    }

    if (appendedTurnIdsRef.current.has(lastTurnId)) {
      return
    }

    const createdAtMs = Date.now()
    appendedTurnIdsRef.current.add(lastTurnId)
    setFeedMessages(previous => [
      ...previous,
      {
        id: `${lastTurnId}:user`,
        role: 'user',
        text: lastTranscript,
        turnId: lastTurnId,
        createdAtMs,
      },
      {
        id: `${lastTurnId}:assistant`,
        role: 'assistant',
        text: lastAssistantText,
        turnId: lastTurnId,
        createdAtMs,
      },
    ])
  }, [lastAssistantText, lastTranscript, lastTurnId])

  const totalFeedMessages = feedMessages.length

  useEffect(() => {
    if (totalFeedMessages === 0) {
      return
    }

    const container = conversationFeedScrollRef.current
    if (!container) {
      return
    }

    container.scrollTop = container.scrollHeight
  }, [totalFeedMessages])

  const visualizerActive = micStatus === 'ready' && !isMuted

  return (
    <main
      className={cn(
        'flex-col flex gap-3 md:gap-4 mx-auto px-3 md:px-6 py-3 md:py-6 max-w-5xl min-h-screen w-full',
        activeSection === 'conversation' && 'h-screen overflow-hidden',
      )}
    >
      <header className="sticky top-0 z-20 flex justify-center backdrop-blur bg-background/90 supports-[backdrop-filter]:bg-background/70 py-2">
        <div className="inline-flex gap-2 items-center bg-card/70 p-1 rounded-xl">
          {SECTIONS.map(section => {
            const Icon = section.icon
            const selected = activeSection === section.id
            return (
              <Button
                className={cn(
                  'shadow-none px-3 border-none h-10',
                  selected
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                    : '',
                )}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Icon className="size-4" />
                <span className="hidden sm:inline ml-2">{section.label}</span>
              </Button>
            )
          })}
        </div>
      </header>

      {activeSection === 'conversation' ? (
        <section className="flex-1 flex-col flex gap-3 min-h-0 overflow-hidden">
          <Card>
            <CardHeader className="space-y-1 pb-2">
              <CardTitle>Беседа</CardTitle>
              <CardDescription className="sm:block hidden">
                Нажмите на визуализатор, чтобы быстро выключить или включить микрофон.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-wrap flex gap-2 items-center">
              <Badge variant={resolveStateBadgeVariant(state)}>State: {resolveConversationStateLabel(state)}</Badge>
              <Badge variant={micStatus === 'ready' ? 'secondary' : 'outline'}>
                Mic: {resolveMicStatusLabel(micStatus)}
              </Badge>
              <Badge variant={isMuted ? 'destructive' : 'outline'}>{isMuted ? 'Muted' : 'Live'}</Badge>
              <Badge variant="outline">Session: {formatDuration(elapsedSec)}</Badge>
            </CardContent>
          </Card>

          <Card className="relative flex-1 min-h-0 overflow-hidden">
            <CardContent className="relative p-0 h-full">
              <button
                aria-label={isMuted ? 'Resume microphone' : 'Mute microphone'}
                className="absolute group inset-0 flex items-center justify-center"
                onClick={toggleMute}
                type="button"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-background to-background via-background/50" />
                <div className="relative h-full w-full duration-150 group-hover:scale-[1.005] transition-transform">
                  <AudioOscilloscopeVisualizer
                    analyser={analyserNode}
                    audioReactivity={1}
                    backWireOpacity={0.25}
                    cameraZ={7.1}
                    className="h-full w-full"
                    distortion={1}
                    dpr={[1, 1.6]}
                    freezeWhenInactive
                    haloResolution={64}
                    haloStrength={0.95}
                    idleRotationSpeed={0}
                    isActive={visualizerActive}
                    lineAmplitude={58}
                    lineCount={3}
                    linePoints={168}
                    lineSpatialSmoothingPasses={2}
                    lineTemporalSmoothing={0.16}
                    meshResolution={2}
                    rotationSpeed={0.12}
                    showIdleRings={false}
                    wireframeOpacity={0.52}
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="backdrop-blur bg-card/80 shadow-xl px-4 py-2 border rounded-full">
                      <p className="font-medium text-sm">{isMuted ? 'Mic paused' : 'Mic active'}</p>
                      <p className="text-muted-foreground text-xs">{Math.round(visibleLevel * 100)}% input level</p>
                    </div>
                  </div>
                </div>
              </button>
            </CardContent>
          </Card>

          <Card className="h-[clamp(7.5rem,24vh,12rem)] shrink-0">
            <CardContent className="px-3 py-1.5 h-full">
              {feedMessages.length > 0 ? (
                <div className="pr-1 h-full overflow-y-auto" ref={conversationFeedScrollRef}>
                  <div className="flex-col flex gap-1.5 justify-end min-h-full">
                    {feedMessages.map(message => (
                      <div
                        className={cn(
                          'shadow-sm px-3 py-2 border rounded-xl max-w-[92%] text-sm',
                          message.role === 'assistant' ? 'bg-card' : 'ml-auto bg-secondary',
                        )}
                        key={message.id}
                      >
                        <p className="mb-0.5 text-[11px] text-muted-foreground">
                          {resolveFeedRoleLabel(message.role)} • {formatClockTime(message.createdAtMs)}
                        </p>
                        <p className="whitespace-pre-wrap">{message.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="bg-card/70 px-3 py-2 border rounded-xl text-muted-foreground text-sm">
                  Сообщений пока нет. Начните говорить, чтобы увидеть ход диалога.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {activeSection === 'messages' ? (
        <section className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Сообщения</CardTitle>
              <CardDescription>История текущей сессии с авторами и временными метками.</CardDescription>
            </CardHeader>
            <CardContent>
              {feedMessages.length > 0 ? (
                <div className="space-y-3">
                  {feedMessages.map(message => (
                    <article
                      className={cn('flex', message.role === 'assistant' ? 'justify-start' : 'justify-end')}
                      key={message.id}
                    >
                      <div
                        className={cn(
                          'px-4 py-3 border rounded-2xl max-w-[82%] w-full',
                          message.role === 'assistant' ? 'bg-card' : 'bg-secondary',
                        )}
                      >
                        <p className="mb-1 text-muted-foreground text-xs">
                          {resolveFeedRoleLabel(message.role)} • {formatClockTime(message.createdAtMs)}
                        </p>
                        <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="bg-card/70 px-3 py-3 border rounded-xl text-muted-foreground text-sm">
                  История пуста. Сообщения начнут отображаться после первого успешного turn.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {activeSection === 'settings' ? (
        <section className="gap-4 md:grid-cols-2 grid">
          <Card>
            <CardHeader>
              <CardTitle>Сессия</CardTitle>
              <CardDescription>Базовые действия и текущее состояние аудио.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="gap-2 grid-cols-2 grid">
                <Button onClick={toggleMute} variant={isMuted ? 'secondary' : 'destructive'}>
                  Mute / Resume
                </Button>
                <Button onClick={resetSession} variant="outline">
                  Reset Session
                </Button>
                <Button onClick={reconnectMicrophone} variant="secondary">
                  Reconnect Mic
                </Button>
                <Button disabled={isMuted || micStatus !== 'ready'} onClick={releaseUtteranceUrl}>
                  Clear Recording
                </Button>
              </div>
              <div className="bg-muted/30 p-3 border rounded text-muted-foreground text-xs">
                capture: {captureStage} | mic: {resolveMicStatusLabel(micStatus)}
              </div>
              {lastUtterance ? (
                // biome-ignore lint/a11y/useMediaCaption: local mic preview audio has no caption track source.
                <audio className="w-full" controls src={lastUtterance.url} />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Голос ассистента</CardTitle>
              <CardDescription>Persona и голос для TTS.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <p className="font-medium text-sm">Persona</p>
                <div className="gap-2 grid-cols-3 grid">
                  {PERSONA_ORDER.map(persona => (
                    <Button
                      key={persona}
                      onClick={() => setPersona(persona)}
                      size="sm"
                      variant={activePersona === persona ? 'default' : 'outline'}
                    >
                      {persona}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="font-medium text-sm">Voice</p>
                <div className="gap-2 grid-cols-3 grid">
                  {VOICE_ORDER.map(voice => (
                    <Button
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
              <CardTitle>Распознавание речи</CardTitle>
              <CardDescription>Языковой фильтр и режим STT.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button onClick={toggleSttLanguageMode} variant={sttLanguageMode === 'strict' ? 'default' : 'outline'}>
                Language filter: {sttLanguageMode === 'strict' ? 'strict' : 'off (faster)'}
              </Button>
              <div className="gap-2 grid-cols-2 grid">
                {STT_LANGUAGE_ORDER.map(language => (
                  <Button
                    className="justify-start"
                    key={language}
                    onClick={() => toggleSttLanguage(language)}
                    size="sm"
                    variant={selectedSttLanguages.includes(language) ? 'secondary' : 'outline'}
                  >
                    {STT_LANGUAGE_LABELS[language]} ({language})
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Чувствительность</CardTitle>
              <CardDescription>VAD пресет и технические параметры.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="gap-2 grid-cols-3 grid">
                {VAD_PRESET_ORDER.map(preset => (
                  <Button
                    key={preset}
                    onClick={() => setPreset(preset)}
                    size="sm"
                    variant={activePreset === preset ? 'default' : 'outline'}
                  >
                    {preset}
                  </Button>
                ))}
              </div>
              <div className="bg-muted/30 p-3 border rounded text-muted-foreground text-xs">
                threshold: {activeConfig.thresholdDb} dB | startHold: {activeConfig.startHoldMs} ms | endHold:{' '}
                {activeConfig.endHoldMs} ms
              </div>
              <div className="bg-muted/30 p-3 border rounded text-muted-foreground text-xs">
                STT: {sttLatencyMs ?? '--'} ms | LLM: {llmLatencyMs ?? '--'} ms | TTS: {ttsLatencyMs ?? '--'} ms
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {(lastNotice || lastError) && activeSection !== 'settings' ? (
        <Card>
          <CardContent className="space-y-2 py-2">
            {lastNotice ? (
              <p className="bg-muted/40 px-3 py-2 border rounded text-muted-foreground text-sm">{lastNotice}</p>
            ) : null}
            {lastError ? <p className="px-3 py-2 border rounded text-destructive text-sm">{lastError}</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </main>
  )
}
