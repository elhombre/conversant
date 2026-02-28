import { useCallback, useState } from 'react'
import type { VadPreset } from '../vad/types'
import type {
  AudioCtxState,
  CaptureStage,
  ConversationState,
  LastUtterance,
  MicStatus,
  PersonaId,
  SttLanguageCode,
  SttLanguageMode,
  VoiceId,
} from './engine-types'

export function useConversationState() {
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

  return {
    state,
    setState,
    captureStage,
    setCaptureStage,
    micStatus,
    setMicStatus,
    audioContextState,
    setAudioContextState,
    inputLevel,
    setInputLevel,
    isMuted,
    setIsMuted,
    interruptionCount,
    setInterruptionCount,
    lastError,
    setLastError,
    activePreset,
    setActivePreset,
    activePersona,
    setActivePersona,
    activeVoice,
    setActiveVoice,
    sttLanguageMode,
    setSttLanguageMode,
    selectedSttLanguages,
    setSelectedSttLanguages,
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
    toggleSttLanguageMode,
    toggleSttLanguage,
  }
}
