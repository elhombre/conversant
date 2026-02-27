import type { VadConfig, VadPreset } from '@/lib/vad/types'

export const VAD_PRESETS: Record<VadPreset, VadConfig> = {
  Normal: {
    thresholdDb: -43,
    startHoldMs: 80,
    endHoldMs: 520,
    minSpeechMs: 220,
    maxUtteranceMs: 15000,
  },
  Noisy: {
    thresholdDb: -36,
    startHoldMs: 120,
    endHoldMs: 720,
    minSpeechMs: 300,
    maxUtteranceMs: 15000,
  },
  Thoughtful: {
    thresholdDb: -45,
    startHoldMs: 70,
    endHoldMs: 900,
    minSpeechMs: 240,
    maxUtteranceMs: 18000,
  },
}

export const VAD_PRESET_ORDER: VadPreset[] = ['Normal', 'Noisy', 'Thoughtful']
