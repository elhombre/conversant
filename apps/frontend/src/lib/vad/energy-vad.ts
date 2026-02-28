import type { VadConfig, VadEvent } from '@/lib/vad/types'

type EnergyVadState = {
  speaking: boolean
  aboveSinceMs: number | null
  belowSinceMs: number | null
  speechStartMs: number | null
}

export class EnergyVad {
  private config: VadConfig

  private state: EnergyVadState = {
    speaking: false,
    aboveSinceMs: null,
    belowSinceMs: null,
    speechStartMs: null,
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
  }

  process(db: number, nowMs: number): VadEvent | null {
    const { thresholdDb, startHoldMs, endHoldMs, minSpeechMs, maxUtteranceMs } = this.config

    if (!this.state.speaking) {
      if (db >= thresholdDb) {
        if (this.state.aboveSinceMs === null) {
          this.state.aboveSinceMs = nowMs
        }

        if (nowMs - this.state.aboveSinceMs >= startHoldMs) {
          this.state.speaking = true
          this.state.speechStartMs = nowMs
          this.state.belowSinceMs = null
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

    if (speechDurationMs >= maxUtteranceMs) {
      this.state.speaking = false
      this.state.aboveSinceMs = null
      this.state.belowSinceMs = null
      this.state.speechStartMs = null

      return {
        type: 'speech_end',
        atMs: nowMs,
        durationMs: speechDurationMs,
        reason: 'max_utterance',
        accepted: speechDurationMs >= minSpeechMs,
      }
    }

    if (db < thresholdDb) {
      if (this.state.belowSinceMs === null) {
        this.state.belowSinceMs = nowMs
      }

      if (nowMs - this.state.belowSinceMs >= endHoldMs) {
        this.state.speaking = false
        this.state.aboveSinceMs = null
        this.state.belowSinceMs = null
        this.state.speechStartMs = null

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
