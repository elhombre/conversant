export type VadPreset = 'Normal' | 'Noisy' | 'Thoughtful'

export type VadConfig = {
  thresholdDb: number
  endThresholdOffsetDb: number
  endDropFromPeakDb: number
  startHoldMs: number
  endHoldMs: number
  minSpeechMs: number
  maxUtteranceMs: number
}

export type VadEndReason = 'silence' | 'max_utterance'

export type VadEvent =
  | {
      type: 'speech_start'
      atMs: number
    }
  | {
      type: 'speech_end'
      atMs: number
      durationMs: number
      reason: VadEndReason
      accepted: boolean
    }
