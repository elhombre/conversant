'use client'

import {
  PERSONA_ORDER,
  STT_LANGUAGE_LABELS,
  STT_LANGUAGE_ORDER,
  useConversationEngine,
  VAD_PRESET_ORDER,
  VOICE_ORDER,
} from '@conversant/conversation-engine'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function Home() {
  const {
    state,
    captureStage,
    micStatus,
    audioContextState,
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
  } = useConversationEngine()

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 p-4 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Conversant - Stage 5 Engine</CardTitle>
          <CardDescription>
            ConversationEngine orchestration with VAD, STT, LLM, TTS, playback, and barge-in.
          </CardDescription>
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
              <Button className="w-full" onClick={reconnectMicrophone} variant="secondary">
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

            {lastNotice ? (
              <div className="rounded border border-border/70 bg-muted/40 p-3 text-muted-foreground">{lastNotice}</div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
