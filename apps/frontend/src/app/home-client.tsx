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

  const recentOverlayMessages = feedMessages.slice(-6)

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
      <header className="sticky top-0 z-20 flex justify-center border-b bg-background/90 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="inline-flex items-center gap-2 rounded-xl border bg-card p-1">
          {SECTIONS.map(section => {
            const Icon = section.icon
            const selected = activeSection === section.id
            return (
              <Button
                className={cn(
                  'h-10 px-3',
                  selected &&
                    'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
                )}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                size="sm"
                type="button"
                variant="outline"
              >
                <Icon className="size-4" />
                <span className="ml-2 hidden sm:inline">{section.label}</span>
              </Button>
            )
          })}
        </div>
      </header>

      {activeSection === 'conversation' ? (
        <section className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Беседа</CardTitle>
              <CardDescription>Нажмите на визуализатор, чтобы быстро выключить или включить микрофон.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <Badge variant={resolveStateBadgeVariant(state)}>State: {resolveConversationStateLabel(state)}</Badge>
              <Badge variant={micStatus === 'ready' ? 'secondary' : 'outline'}>
                Mic: {resolveMicStatusLabel(micStatus)}
              </Badge>
              <Badge variant={isMuted ? 'destructive' : 'outline'}>{isMuted ? 'Muted' : 'Live'}</Badge>
              <Badge variant="outline">Session: {formatDuration(elapsedSec)}</Badge>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            <CardContent className="relative h-[500px] p-0">
              <button
                aria-label={isMuted ? 'Resume microphone' : 'Mute microphone'}
                className="group absolute inset-0 flex items-center justify-center"
                onClick={toggleMute}
                type="button"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-background via-background/60 to-background" />
                <div className="relative flex size-[230px] items-center justify-center rounded-full border bg-card/80 shadow-2xl transition-transform duration-150 group-hover:scale-[1.01] md:size-[270px]">
                  <div
                    className={cn(
                      'absolute inset-6 rounded-full transition-all duration-150 md:inset-7',
                      isMuted ? 'bg-muted' : 'bg-primary/20',
                    )}
                    style={{
                      transform: `scale(${0.78 + visibleLevel * 0.42})`,
                    }}
                  />
                  <div className="relative flex flex-col items-center gap-1 text-center">
                    <p className="text-sm font-medium">{isMuted ? 'Mic paused' : 'Mic active'}</p>
                    <p className="text-xs text-muted-foreground">{Math.round(visibleLevel * 100)}% input level</p>
                  </div>
                </div>
              </button>

              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-background via-background/90 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 max-h-56 overflow-y-auto px-4 pb-4">
                {recentOverlayMessages.length > 0 ? (
                  <div className="space-y-2">
                    {recentOverlayMessages.map(message => (
                      <div
                        className={cn(
                          'max-w-[88%] rounded-xl border px-3 py-2 text-sm shadow-sm',
                          message.role === 'assistant' ? 'bg-card' : 'ml-auto bg-secondary',
                        )}
                        key={message.id}
                      >
                        <p className="mb-1 text-[11px] text-muted-foreground">
                          {resolveFeedRoleLabel(message.role)} • {formatClockTime(message.createdAtMs)}
                        </p>
                        <p className="whitespace-pre-wrap">{message.text}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border bg-card/70 px-3 py-2 text-sm text-muted-foreground">
                    Сообщений пока нет. Начните говорить, чтобы увидеть ход диалога.
                  </p>
                )}
              </div>
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
                          'w-full max-w-[82%] rounded-2xl border px-4 py-3',
                          message.role === 'assistant' ? 'bg-card' : 'bg-secondary',
                        )}
                      >
                        <p className="mb-1 text-xs text-muted-foreground">
                          {resolveFeedRoleLabel(message.role)} • {formatClockTime(message.createdAtMs)}
                        </p>
                        <p className="whitespace-pre-wrap text-sm">{message.text}</p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border bg-card/70 px-3 py-3 text-sm text-muted-foreground">
                  История пуста. Сообщения начнут отображаться после первого успешного turn.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {activeSection === 'settings' ? (
        <section className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Сессия</CardTitle>
              <CardDescription>Базовые действия и текущее состояние аудио.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
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
              <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
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
                <p className="text-sm font-medium">Persona</p>
                <div className="grid grid-cols-3 gap-2">
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
                <p className="text-sm font-medium">Voice</p>
                <div className="grid grid-cols-3 gap-2">
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
              <div className="grid grid-cols-2 gap-2">
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
              <div className="grid grid-cols-3 gap-2">
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
              <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                threshold: {activeConfig.thresholdDb} dB | startHold: {activeConfig.startHoldMs} ms | endHold:{' '}
                {activeConfig.endHoldMs} ms
              </div>
              <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                STT: {sttLatencyMs ?? '--'} ms | LLM: {llmLatencyMs ?? '--'} ms | TTS: {ttsLatencyMs ?? '--'} ms
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {(lastNotice || lastError) && activeSection !== 'settings' ? (
        <Card>
          <CardContent className="space-y-2 py-4">
            {lastNotice ? (
              <p className="rounded border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{lastNotice}</p>
            ) : null}
            {lastError ? <p className="rounded border px-3 py-2 text-sm text-destructive">{lastError}</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </main>
  )
}
