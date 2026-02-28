import type { Dispatch, RefObject, SetStateAction } from 'react'

import type {
  AudioCtxState,
  CaptureStage,
  ConversationState,
  PersonaId,
  SttLanguageCode,
  SttLanguageMode,
  VoiceId,
} from './engine-types'

export type TurnRuntime = {
  activeTurnIdRef: RefObject<string | null>
  conversationIdRef: RefObject<string>
  activeVoiceRef: RefObject<VoiceId>
  activePersonaRef: RefObject<PersonaId>
  sessionTokenRef: RefObject<number>
  isMutedRef: RefObject<boolean>
  contextRef: RefObject<AudioContext | null>
  sttLanguageModeRef: RefObject<SttLanguageMode>
  selectedSttLanguagesRef: RefObject<SttLanguageCode[]>

  sttAbortControllerRef: RefObject<AbortController | null>
  chatAbortControllerRef: RefObject<AbortController | null>
  ttsAbortControllerRef: RefObject<AbortController | null>

  playbackSourceRef: RefObject<AudioBufferSourceNode | null>
  playbackAnalyserRef: RefObject<AnalyserNode | null>
  playbackMediaSourceRef: RefObject<MediaElementAudioSourceNode | null>
  playbackAudioRef: RefObject<HTMLAudioElement | null>
  playbackAudioUrlRef: RefObject<string | null>
  playbackSampleBufferRef: RefObject<Uint8Array | null>
  playbackDbRef: RefObject<number>

  setState: Dispatch<SetStateAction<ConversationState>>
  setCaptureStage: Dispatch<SetStateAction<CaptureStage>>
  setLastError: Dispatch<SetStateAction<string | null>>
  setLastNotice: Dispatch<SetStateAction<string | null>>
  setLastTranscript: Dispatch<SetStateAction<string>>
  setLastAssistantText: Dispatch<SetStateAction<string>>
  setLastTurnId: Dispatch<SetStateAction<string>>
  setLastDetectedLanguage: Dispatch<SetStateAction<string | null>>
  setSttLatencyMs: Dispatch<SetStateAction<number | null>>
  setLlmLatencyMs: Dispatch<SetStateAction<number | null>>
  setTtsLatencyMs: Dispatch<SetStateAction<number | null>>
  setAudioContextState: Dispatch<SetStateAction<AudioCtxState>>

  stopPlayback: () => void
  clearActiveTurn: (turnId: string) => void
  abortTurnRequests: () => void
  startTurnSoftTimeout: (turnId: string, sessionToken: number) => void
}
