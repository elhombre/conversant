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
import AudioOscilloscopeVisualizer, {
  type AudioOscilloscopeColorPalette,
} from '@/components/audio/audio-oscilloscope-visualizer'
import { type ThemeMode, useUiSettings } from '@/components/providers/ui-settings-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { UiLocale } from '@/i18n/config'
import { type MessageKeys, useTypedTranslations } from '@/lib/i18n/use-typed-translations'
import { cn } from '@/lib/utils'

type SectionId = 'conversation' | 'messages' | 'settings'
type FeedRole = 'user' | 'assistant'
type TranscriptRole = 'user' | 'assistant' | 'system'

type FeedMessage = {
  id: string
  role: FeedRole
  text: string
  turnId: string
  createdAtMs: number
}

type TranscriptMessage = {
  id: string
  role: TranscriptRole
  text: string
  turnId: string | null
  createdAtMs: number
}

type TranscriptResponse = {
  conversationId: string
  messages: Array<{
    id: string
    role: TranscriptRole
    content: string
    turnId: string | null
    createdAt: string
  }>
}

type SectionConfig = {
  id: SectionId
  icon: typeof Speech
}

const SECTIONS: SectionConfig[] = [
  {
    id: 'conversation',
    icon: Speech,
  },
  {
    id: 'messages',
    icon: MessageCircleCheck,
  },
  {
    id: 'settings',
    icon: Settings,
  },
]

const LIGHT_THEME_OSCILLOSCOPE_PALETTE: AudioOscilloscopeColorPalette = {
  pointLightPrimary: '#2e6cff',
  pointLightSecondary: '#184ec6',
  coreFrontStart: [0.24, 0.44, 0.88],
  coreFrontEnd: [0.36, 0.56, 0.95],
  coreBackStart: [0.56, 0.77, 1.0],
  coreBackEnd: [0.82, 0.92, 1.0],
  backWireLiftColor: [0.88, 0.95, 1.0],
  auraStart: [0.6, 0.79, 1.0],
  auraEnd: [0.03, 0.17, 0.68],
  lineStroke: [0.1, 0.26, 0.72],
  lineShadow: [0.07, 0.18, 0.54],
}

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

type TranslateFn = (key: MessageKeys, values?: Record<string, string | number | Date>) => string

function resolveConversationStateLabel(state: ConversationState, t: TranslateFn): string {
  switch (state) {
    case 'assistant_speaking':
      return t('state.assistant_speaking')
    case 'processing':
      return t('state.processing')
    case 'user_speaking':
      return t('state.user_speaking')
    case 'error':
      return t('state.error')
    case 'listening':
      return t('state.listening')
  }
}

function resolveMicStatusLabel(status: MicStatus, t: TranslateFn): string {
  switch (status) {
    case 'ready':
      return t('mic.ready')
    case 'requesting':
      return t('mic.requesting')
    case 'denied':
      return t('mic.denied')
    case 'error':
      return t('mic.error')
    case 'idle':
      return t('mic.idle')
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

function resolveFeedRoleLabel(role: FeedRole, t: TranslateFn): string {
  return role === 'assistant' ? t('roles.assistant') : t('roles.you')
}

function resolveTranscriptRoleLabel(role: TranscriptRole, t: TranslateFn): string {
  if (role === 'assistant') {
    return t('roles.assistant')
  }
  if (role === 'system') {
    return t('roles.system')
  }

  return t('roles.you')
}

function resolveSectionLabel(sectionId: SectionId, t: TranslateFn): string {
  switch (sectionId) {
    case 'conversation':
      return t('nav.conversation')
    case 'messages':
      return t('nav.messages')
    case 'settings':
      return t('nav.settings')
  }
}

export function HomeClient() {
  const router = useRouter()
  const t = useTypedTranslations()
  const { locale, setLocale, themeMode, setThemeMode, resolvedTheme } = useUiSettings()
  const [activeSection, setActiveSection] = useState<SectionId>('conversation')
  const [themeReady, setThemeReady] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [feedMessages, setFeedMessages] = useState<FeedMessage[]>([])
  const [transcriptMessages, setTranscriptMessages] = useState<TranscriptMessage[]>([])
  const [transcriptStatus, setTranscriptStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const appendedTurnIdsRef = useRef<Set<string>>(new Set())
  const transcriptRequestIdRef = useRef(0)
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
    activePreset,
    activePersona,
    activeVoice,
    sttLanguageMode,
    selectedSttLanguages,
    lastUtterance,
    lastCompletedTurn,
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
    setThemeReady(true)
  }, [])

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

  const transcriptRefreshKey = lastCompletedTurn?.turnId ?? ''
  const activeTheme: ThemeMode = themeMode

  useEffect(() => {
    if (!conversationId) {
      return
    }

    setFeedMessages([])
    setTranscriptMessages([])
    setTranscriptStatus('idle')
    setTranscriptError(null)
    appendedTurnIdsRef.current.clear()
  }, [conversationId])

  const loadTranscript = useCallback(async (targetConversationId: string, refreshKey?: string | null) => {
    const requestId = transcriptRequestIdRef.current + 1
    transcriptRequestIdRef.current = requestId
    setTranscriptStatus('loading')
    setTranscriptError(null)

    try {
      const params = new URLSearchParams({
        conversationId: targetConversationId,
      })
      if (typeof refreshKey === 'string' && refreshKey.length > 0) {
        params.set('refresh', refreshKey)
      }

      const response = await fetch(`/api/conversation/transcript?${params.toString()}`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        const fallbackMessage = `Failed to load transcript (${response.status})`
        let message = fallbackMessage
        try {
          const body: unknown = await response.json()
          if (typeof body === 'object' && body !== null && 'error' in body) {
            const errorValue = body.error
            if (
              typeof errorValue === 'object' &&
              errorValue !== null &&
              'message' in errorValue &&
              typeof errorValue.message === 'string' &&
              errorValue.message.trim().length > 0
            ) {
              message = errorValue.message
            }
          }
        } catch {
          message = fallbackMessage
        }

        throw new Error(message)
      }

      const payload = (await response.json()) as TranscriptResponse
      const mappedMessages: TranscriptMessage[] = payload.messages.map(message => {
        const parsed = Date.parse(message.createdAt)
        return {
          id: message.id,
          role: message.role,
          text: message.content,
          turnId: message.turnId,
          createdAtMs: Number.isNaN(parsed) ? Date.now() : parsed,
        }
      })

      if (transcriptRequestIdRef.current !== requestId) {
        return
      }

      setTranscriptMessages(mappedMessages)
      setTranscriptStatus('ready')
      setTranscriptError(null)
    } catch (error) {
      if (transcriptRequestIdRef.current !== requestId) {
        return
      }

      const message = error instanceof Error ? error.message : 'Failed to load transcript'
      setTranscriptStatus('error')
      setTranscriptError(message)
    }
  }, [])

  useEffect(() => {
    if (activeSection !== 'messages' || !conversationId) {
      return
    }

    void loadTranscript(conversationId, transcriptRefreshKey)
  }, [activeSection, conversationId, loadTranscript, transcriptRefreshKey])

  useEffect(() => {
    if (!lastCompletedTurn) {
      return
    }

    if (appendedTurnIdsRef.current.has(lastCompletedTurn.turnId)) {
      return
    }

    const createdAtMs = Date.now()
    appendedTurnIdsRef.current.add(lastCompletedTurn.turnId)
    setFeedMessages(previous => [
      ...previous,
      {
        id: `${lastCompletedTurn.turnId}:user`,
        role: 'user',
        text: lastCompletedTurn.transcript,
        turnId: lastCompletedTurn.turnId,
        createdAtMs,
      },
      {
        id: `${lastCompletedTurn.turnId}:assistant`,
        role: 'assistant',
        text: lastCompletedTurn.assistantText,
        turnId: lastCompletedTurn.turnId,
        createdAtMs,
      },
    ])
  }, [lastCompletedTurn])

  const totalFeedMessages = feedMessages.length
  const isLightTheme = themeReady && resolvedTheme === 'light'
  const visualizerPalette = isLightTheme ? LIGHT_THEME_OSCILLOSCOPE_PALETTE : undefined
  const visualizerWireframeOpacity = isLightTheme ? 0.95 : 0.52
  const visualizerBackWireOpacity = isLightTheme ? 0.52 : 0.25
  const visualizerBackWireLift = isLightTheme ? 1 : 0
  const visualizerHaloStrength = isLightTheme ? 1.2 : 0.95
  const visualizerAuraBaseOpacity = isLightTheme ? 0.4 : undefined
  const visualizerAuraAudioOpacity = isLightTheme ? 0.34 : undefined
  const visualizerAuraAdditiveBlending = !isLightTheme
  const visualizerRenderProfile = isLightTheme ? 'light' : 'default'
  const visualizerHaloResolution = isLightTheme ? 92 : 64
  const setUiLocale = useCallback(
    (nextLocale: UiLocale) => {
      if (nextLocale === locale) {
        return
      }

      setLocale(nextLocale)
    },
    [locale, setLocale],
  )

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
      <header className="sticky top-0 z-20 flex justify-center backdrop-blur bg-background/90 supports-backdrop-filter:bg-background/70 py-2">
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
                <span className="hidden sm:inline ml-2">{resolveSectionLabel(section.id, t)}</span>
              </Button>
            )
          })}
        </div>
      </header>

      {activeSection === 'conversation' ? (
        <section className="flex-1 flex-col flex gap-3 min-h-0 overflow-hidden">
          <Card>
            <CardHeader className="space-y-1 pb-2">
              <CardTitle>{t('conversation.title')}</CardTitle>
              <CardDescription className="sm:block hidden">{t('conversation.description')}</CardDescription>
            </CardHeader>
            <CardContent className="flex-wrap flex gap-2 items-center">
              <Badge variant={resolveStateBadgeVariant(state)}>
                {t('badges.state')}: {resolveConversationStateLabel(state, t)}
              </Badge>
              <Badge variant={micStatus === 'ready' ? 'secondary' : 'outline'}>
                {t('badges.mic')}: {resolveMicStatusLabel(micStatus, t)}
              </Badge>
              <Badge variant={isMuted ? 'destructive' : 'outline'}>
                {isMuted ? t('badges.muted') : t('badges.live')}
              </Badge>
              <Badge variant="outline">
                {t('badges.session')}: {formatDuration(elapsedSec)}
              </Badge>
            </CardContent>
          </Card>

          <Card className="relative flex-1 min-h-0 overflow-hidden">
            <CardContent className="relative p-0 h-full">
              <button
                aria-label={isMuted ? t('conversation.ariaResumeMic') : t('conversation.ariaMuteMic')}
                className="absolute group inset-0 flex items-center justify-center"
                onClick={toggleMute}
                type="button"
              >
                <div
                  className={cn(
                    'absolute inset-0',
                    isLightTheme
                      ? 'bg-linear-to-b from-transparent via-blue-50/10 to-blue-100/16'
                      : 'bg-linear-to-b from-background to-background via-background/50',
                  )}
                />
                <div className="relative h-full w-full duration-150 group-hover:scale-[1.005] transition-transform">
                  <AudioOscilloscopeVisualizer
                    analyser={analyserNode}
                    audioReactivity={1}
                    auraAudioOpacity={visualizerAuraAudioOpacity}
                    auraBaseOpacity={visualizerAuraBaseOpacity}
                    auraAdditiveBlending={visualizerAuraAdditiveBlending}
                    backWireLift={visualizerBackWireLift}
                    cameraZ={7.1}
                    className="h-full w-full"
                    distortion={1}
                    dpr={[1, 1.6]}
                    freezeWhenInactive
                    haloResolution={visualizerHaloResolution}
                    haloStrength={visualizerHaloStrength}
                    idleRotationSpeed={0}
                    isActive={visualizerActive}
                    lineAmplitude={58}
                    lineSensitivity={2}
                    lineCount={3}
                    linePoints={168}
                    lineSpatialSmoothingPasses={2}
                    lineTemporalSmoothing={0.16}
                    meshResolution={2}
                    palette={visualizerPalette}
                    renderProfile={visualizerRenderProfile}
                    rotationSpeed={0.12}
                    showIdleRings={false}
                    wireframeOpacity={visualizerWireframeOpacity}
                    backWireOpacity={visualizerBackWireOpacity}
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="backdrop-blur bg-card/80 shadow-xl px-4 py-2 border rounded-full">
                      <p className="font-medium text-sm">
                        {isMuted ? t('conversation.micPaused') : t('conversation.micActive')}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {Math.round(visibleLevel * 100)}
                        {t('conversation.inputLevelSuffix')}
                      </p>
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
                          {resolveFeedRoleLabel(message.role, t)} • {formatClockTime(message.createdAtMs)}
                        </p>
                        <p className="whitespace-pre-wrap">{message.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="bg-card/70 px-3 py-2 border rounded-xl text-muted-foreground text-sm">
                  {t('conversation.empty')}
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
              <CardTitle>{t('messages.title')}</CardTitle>
              <CardDescription>{t('messages.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {!conversationId ? (
                <p className="bg-card/70 px-3 py-3 border rounded-xl text-muted-foreground text-sm">
                  {t('messages.sessionNotStarted')}
                </p>
              ) : transcriptStatus === 'loading' && transcriptMessages.length === 0 ? (
                <p className="bg-card/70 px-3 py-3 border rounded-xl text-muted-foreground text-sm">
                  {t('messages.loading')}
                </p>
              ) : transcriptStatus === 'error' ? (
                <div className="space-y-3">
                  <p className="px-3 py-3 border rounded-xl text-destructive text-sm">
                    {transcriptError ?? t('messages.loadErrorDefault')}
                  </p>
                  <Button
                    onClick={() => void loadTranscript(conversationId, transcriptRefreshKey)}
                    size="sm"
                    variant="outline"
                  >
                    {t('messages.retry')}
                  </Button>
                </div>
              ) : transcriptMessages.length > 0 ? (
                <div className="space-y-3">
                  {transcriptMessages.map(message => (
                    <article
                      className={cn(
                        'flex',
                        message.role === 'assistant'
                          ? 'justify-start'
                          : message.role === 'system'
                            ? 'justify-center'
                            : 'justify-end',
                      )}
                      key={message.id}
                    >
                      <div
                        className={cn(
                          'px-4 py-3 border rounded-2xl max-w-[82%] w-full',
                          message.role === 'assistant'
                            ? 'bg-card'
                            : message.role === 'system'
                              ? 'bg-muted/40 border-dashed'
                              : 'bg-secondary',
                        )}
                      >
                        <p className="mb-1 text-muted-foreground text-xs">
                          {resolveTranscriptRoleLabel(message.role, t)} • {formatClockTime(message.createdAtMs)}
                        </p>
                        <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="bg-card/70 px-3 py-3 border rounded-xl text-muted-foreground text-sm">
                  {t('messages.empty')}
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
              <CardTitle>{t('settings.appearance.title')}</CardTitle>
              <CardDescription>{t('settings.appearance.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <p className="font-medium text-sm">{t('settings.appearance.theme')}</p>
                <div className="gap-2 grid-cols-3 grid">
                  <Button
                    disabled={!themeReady}
                    onClick={() => setThemeMode('system')}
                    size="sm"
                    variant={activeTheme === 'system' ? 'default' : 'outline'}
                  >
                    {t('settings.appearance.themeSystem')}
                  </Button>
                  <Button
                    disabled={!themeReady}
                    onClick={() => setThemeMode('light')}
                    size="sm"
                    variant={activeTheme === 'light' ? 'default' : 'outline'}
                  >
                    {t('settings.appearance.themeLight')}
                  </Button>
                  <Button
                    disabled={!themeReady}
                    onClick={() => setThemeMode('dark')}
                    size="sm"
                    variant={activeTheme === 'dark' ? 'default' : 'outline'}
                  >
                    {t('settings.appearance.themeDark')}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="font-medium text-sm">{t('settings.appearance.language')}</p>
                <div className="gap-2 grid-cols-2 grid">
                  <Button onClick={() => setUiLocale('en')} size="sm" variant={locale === 'en' ? 'default' : 'outline'}>
                    {t('settings.appearance.languageEn')}
                  </Button>
                  <Button onClick={() => setUiLocale('ru')} size="sm" variant={locale === 'ru' ? 'default' : 'outline'}>
                    {t('settings.appearance.languageRu')}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.session.title')}</CardTitle>
              <CardDescription>{t('settings.session.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="gap-2 grid-cols-2 grid">
                <Button onClick={toggleMute} variant={isMuted ? 'secondary' : 'destructive'}>
                  {t('settings.session.muteResume')}
                </Button>
                <Button onClick={resetSession} variant="outline">
                  {t('settings.session.resetSession')}
                </Button>
                <Button onClick={reconnectMicrophone} variant="secondary">
                  {t('settings.session.reconnectMic')}
                </Button>
                <Button disabled={isMuted || micStatus !== 'ready'} onClick={releaseUtteranceUrl}>
                  {t('settings.session.clearRecording')}
                </Button>
              </div>
              <div className="bg-muted/30 p-3 border rounded text-muted-foreground text-xs">
                {t('settings.session.capture')}: {captureStage} | {t('settings.session.mic')}:{' '}
                {resolveMicStatusLabel(micStatus, t)}
              </div>
              {lastUtterance ? (
                // biome-ignore lint/a11y/useMediaCaption: local mic preview audio has no caption track source.
                <audio className="w-full" controls src={lastUtterance.url} />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.voice.title')}</CardTitle>
              <CardDescription>{t('settings.voice.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <p className="font-medium text-sm">{t('settings.voice.persona')}</p>
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
                <p className="font-medium text-sm">{t('settings.voice.voice')}</p>
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
              <CardTitle>{t('settings.stt.title')}</CardTitle>
              <CardDescription>{t('settings.stt.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button onClick={toggleSttLanguageMode} variant={sttLanguageMode === 'strict' ? 'default' : 'outline'}>
                {t('settings.stt.languageFilter')}:{' '}
                {sttLanguageMode === 'strict' ? t('settings.stt.strict') : t('settings.stt.offFaster')}
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
              <CardTitle>{t('settings.sensitivity.title')}</CardTitle>
              <CardDescription>{t('settings.sensitivity.description')}</CardDescription>
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
                {t('settings.sensitivity.threshold')}: {activeConfig.thresholdDb} dB |{' '}
                {t('settings.sensitivity.startHold')}: {activeConfig.startHoldMs} ms |{' '}
                {t('settings.sensitivity.endHold')}: {activeConfig.endHoldMs} ms
              </div>
              <div className="bg-muted/30 p-3 border rounded text-muted-foreground text-xs">
                {t('settings.sensitivity.stt')}: {sttLatencyMs ?? '--'} ms | {t('settings.sensitivity.llm')}:{' '}
                {llmLatencyMs ?? '--'} ms | {t('settings.sensitivity.tts')}: {ttsLatencyMs ?? '--'} ms
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </main>
  )
}
