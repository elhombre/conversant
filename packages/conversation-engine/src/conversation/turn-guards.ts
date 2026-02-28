import type { TurnRuntime } from './turn-runtime'

type TurnIdentity = Pick<TurnRuntime, 'activeTurnIdRef' | 'sessionTokenRef'>

type AbortTransition = Pick<TurnRuntime, 'clearActiveTurn' | 'isMutedRef' | 'setCaptureStage' | 'setState'>

export function isTurnStale(identity: TurnIdentity, turnId: string, sessionToken: number) {
  return identity.sessionTokenRef.current !== sessionToken || identity.activeTurnIdRef.current !== turnId
}

export function settleAbortedTurn(transition: AbortTransition, turnId: string) {
  transition.setCaptureStage('idle')
  if (!transition.isMutedRef.current) {
    transition.setState('listening')
  }
  transition.clearActiveTurn(turnId)
}
