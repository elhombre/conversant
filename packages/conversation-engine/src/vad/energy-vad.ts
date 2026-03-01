import type { VadConfig, VadEvent } from './types'

type EnergyVadState = {
  speaking: boolean
  aboveSinceMs: number | null
  belowSinceMs: number | null
  speechStartMs: number | null
  speechPeakDb: number | null
}

export class EnergyVad {
  private config: VadConfig

  private state: EnergyVadState = {
    speaking: false,
    aboveSinceMs: null,
    belowSinceMs: null,
    speechStartMs: null,
    speechPeakDb: null,
  }

  constructor(config: VadConfig) {
    this.config = config
  }

  setConfig(config: VadConfig) {
    this.config = config
    this.reset()
  }

  reset() {
    this.state = {
      speaking: false,
      aboveSinceMs: null,
      belowSinceMs: null,
      speechStartMs: null,
      speechPeakDb: null,
    }
  }

  isSpeaking() {
    return this.state.speaking
  }

  forceSpeechStart(atMs: number) {
    this.state.speaking = true
    this.state.aboveSinceMs = atMs
    this.state.belowSinceMs = null
    this.state.speechStartMs = atMs
    this.state.speechPeakDb = null
  }

  process(db: number, nowMs: number): VadEvent | null {
    const { thresholdDb, endThresholdOffsetDb, endDropFromPeakDb, startHoldMs, endHoldMs, minSpeechMs, maxUtteranceMs } =
      this.config
    const endThresholdDb = thresholdDb + endThresholdOffsetDb

    if (!this.state.speaking) {
      if (db >= thresholdDb) {
        if (this.state.aboveSinceMs === null) {
          this.state.aboveSinceMs = nowMs
        }

        if (nowMs - this.state.aboveSinceMs >= startHoldMs) {
          this.state.speaking = true
          this.state.speechStartMs = nowMs
          this.state.belowSinceMs = null
          this.state.speechPeakDb = db
          return {
            type: 'speech_start',
            atMs: nowMs,
          }
        }
      } else {
        this.state.aboveSinceMs = null
      }

      return null
    }

    const speechStartMs = this.state.speechStartMs ?? nowMs
    const speechDurationMs = nowMs - speechStartMs
    if (this.state.speechPeakDb === null || db > this.state.speechPeakDb) {
      this.state.speechPeakDb = db
    }

    if (speechDurationMs >= maxUtteranceMs) {
      this.state.speaking = false
      this.state.aboveSinceMs = null
      this.state.belowSinceMs = null
      this.state.speechStartMs = null
      this.state.speechPeakDb = null

      return {
        type: 'speech_end',
        atMs: nowMs,
        durationMs: speechDurationMs,
        reason: 'max_utterance',
        accepted: speechDurationMs >= minSpeechMs,
      }
    }

    const peakDb = this.state.speechPeakDb
    const relativeEndThresholdDb =
      peakDb !== null && endDropFromPeakDb > 0 ? peakDb - endDropFromPeakDb : Number.NEGATIVE_INFINITY
    const effectiveEndThresholdDb = Math.max(endThresholdDb, relativeEndThresholdDb)

    if (db < effectiveEndThresholdDb) {
      if (this.state.belowSinceMs === null) {
        this.state.belowSinceMs = nowMs
      }

      if (nowMs - this.state.belowSinceMs >= endHoldMs) {
        this.state.speaking = false
        this.state.aboveSinceMs = null
        this.state.belowSinceMs = null
        this.state.speechStartMs = null
        this.state.speechPeakDb = null

        return {
          type: 'speech_end',
          atMs: nowMs,
          durationMs: speechDurationMs,
          reason: 'silence',
          accepted: speechDurationMs >= minSpeechMs,
        }
      }
    } else {
      this.state.belowSinceMs = null
    }

    return null
  }
}
