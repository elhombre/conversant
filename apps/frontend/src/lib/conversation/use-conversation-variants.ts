import { useMemo } from 'react'

import type { BadgeVariant, CaptureStage, ConversationState, MicStatus } from '@/lib/conversation/engine-types'

type UseConversationVariantsParams = {
  state: ConversationState
  micStatus: MicStatus
  captureStage: CaptureStage
}

export function useConversationVariants({ state, micStatus, captureStage }: UseConversationVariantsParams) {
  const stateVariant = useMemo<BadgeVariant>(() => {
    if (state === 'error') return 'destructive'
    if (state === 'processing') return 'secondary'
    if (state === 'assistant_speaking') return 'outline'
    return 'default'
  }, [state])

  const micVariant = useMemo<BadgeVariant>(() => {
    if (micStatus === 'ready') return 'default'
    if (micStatus === 'requesting') return 'secondary'
    if (micStatus === 'denied' || micStatus === 'error') return 'destructive'
    return 'outline'
  }, [micStatus])

  const captureVariant = useMemo<BadgeVariant>(() => {
    if (captureStage === 'speaking') return 'default'
    if (captureStage === 'finalizing') return 'secondary'
    return 'outline'
  }, [captureStage])

  return {
    stateVariant,
    micVariant,
    captureVariant,
  }
}
