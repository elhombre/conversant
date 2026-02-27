import type { ConversationState } from './engine-types'
import { isTurnStale } from './turn-guards'
import type { TurnRuntime } from './turn-runtime'

type PlaybackParams = {
  runtime: TurnRuntime
  turnId: string
  sessionToken: number
  blob: Blob
}

function finalizePlayback({
  runtime,
  turnId,
  sessionToken,
  nextState,
  message,
}: {
  runtime: TurnRuntime
  turnId: string
  sessionToken: number
  nextState: ConversationState
  message: string | null
}) {
  runtime.stopPlayback()

  if (isTurnStale(runtime, turnId, sessionToken)) {
    return
  }

  runtime.setCaptureStage('idle')
  runtime.setLastError(message)
  runtime.setState(nextState)
  runtime.clearActiveTurn(turnId)
}

export async function playTtsBlobForTurn({ runtime, turnId, sessionToken, blob }: PlaybackParams) {
  runtime.stopPlayback()

  const currentContext = runtime.contextRef.current
  if (currentContext) {
    if (currentContext.state === 'suspended') {
      await currentContext.resume()
      runtime.setAudioContextState(currentContext.state)
    }

    if (currentContext.state === 'running') {
      try {
        const rawBuffer = await blob.arrayBuffer()
        const decodedBuffer = await currentContext.decodeAudioData(rawBuffer.slice(0))

        if (isTurnStale(runtime, turnId, sessionToken)) {
          return
        }

        const source = currentContext.createBufferSource()
        source.buffer = decodedBuffer

        const playbackAnalyser = currentContext.createAnalyser()
        playbackAnalyser.fftSize = 1024
        playbackAnalyser.smoothingTimeConstant = 0.8

        source.connect(playbackAnalyser)
        playbackAnalyser.connect(currentContext.destination)

        runtime.playbackSourceRef.current = source
        runtime.playbackAnalyserRef.current = playbackAnalyser
        runtime.playbackSampleBufferRef.current = null
        runtime.playbackDbRef.current = -100

        source.onended = () => {
          finalizePlayback({
            runtime,
            turnId,
            sessionToken,
            nextState: 'listening',
            message: null,
          })
        }

        runtime.setState('assistant_speaking')
        runtime.setCaptureStage('idle')
        source.start(0)
        return
      } catch {
        // Fallback below to HTMLAudioElement playback if WebAudio decode fails.
      }
    }
  }

  const audioUrl = URL.createObjectURL(blob)
  const audio = new Audio(audioUrl)
  audio.preload = 'auto'

  runtime.playbackAudioRef.current = audio
  runtime.playbackAudioUrlRef.current = audioUrl
  runtime.playbackDbRef.current = -100

  const fallbackContext = runtime.contextRef.current
  if (fallbackContext && fallbackContext.state === 'running') {
    try {
      const mediaSource = fallbackContext.createMediaElementSource(audio)
      const playbackAnalyser = fallbackContext.createAnalyser()
      playbackAnalyser.fftSize = 1024
      playbackAnalyser.smoothingTimeConstant = 0.8

      mediaSource.connect(playbackAnalyser)
      playbackAnalyser.connect(fallbackContext.destination)

      runtime.playbackMediaSourceRef.current = mediaSource
      runtime.playbackAnalyserRef.current = playbackAnalyser
      runtime.playbackSampleBufferRef.current = null
    } catch {
      runtime.playbackMediaSourceRef.current = null
      runtime.playbackAnalyserRef.current = null
      runtime.playbackSampleBufferRef.current = null
    }
  }

  audio.onended = () => {
    finalizePlayback({
      runtime,
      turnId,
      sessionToken,
      nextState: 'listening',
      message: null,
    })
  }

  audio.onerror = () => {
    finalizePlayback({
      runtime,
      turnId,
      sessionToken,
      nextState: 'error',
      message: 'Playback failed. Check browser audio output settings.',
    })
  }

  runtime.setState('assistant_speaking')
  runtime.setCaptureStage('idle')

  try {
    await audio.play()
  } catch {
    finalizePlayback({
      runtime,
      turnId,
      sessionToken,
      nextState: 'listening',
      message: 'Playback was blocked by browser autoplay policy. Interact with the page and retry.',
    })
  }
}
