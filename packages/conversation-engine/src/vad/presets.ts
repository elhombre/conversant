import type { VadConfig, VadPreset } from './types'

export const VAD_PRESETS: Record<VadPreset, VadConfig> = {
  Normal: {
    thresholdDb: -52,
    endThresholdOffsetDb: 0,
    endDropFromPeakDb: 0,
    startHoldMs: 80,
    endHoldMs: 520,
    minSpeechMs: 220,
    maxUtteranceMs: 15000,
  },
  Noisy: {
    thresholdDb: -45,
    endThresholdOffsetDb: 0,
    endDropFromPeakDb: 0,
    startHoldMs: 120,
    endHoldMs: 720,
    minSpeechMs: 300,
    maxUtteranceMs: 15000,
  },
  Thoughtful: {
    thresholdDb: -55,
    endThresholdOffsetDb: 0,
    endDropFromPeakDb: 0,
    startHoldMs: 70,
    endHoldMs: 900,
    minSpeechMs: 240,
    maxUtteranceMs: 18000,
  },
}

export const VAD_PRESET_ORDER: VadPreset[] = ['Normal', 'Noisy', 'Thoughtful']
