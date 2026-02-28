import { getConversationTranscript } from '@conversant/backend-data'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireSessionUserIdFromCookies } from '@/lib/auth/page-user'

export const dynamic = 'force-dynamic'

type ConversationEndedPageProps = {
  params: Promise<{
    conversationId: string
  }>
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'medium',
})

function roleLabel(role: 'user' | 'assistant' | 'system') {
  if (role === 'assistant') {
    return 'Assistant'
  }
  if (role === 'system') {
    return 'System'
  }

  return 'User'
}

function roleVariant(role: 'user' | 'assistant' | 'system'): 'default' | 'secondary' | 'outline' {
  if (role === 'assistant') {
    return 'secondary'
  }
  if (role === 'system') {
    return 'outline'
  }

  return 'default'
}

function resolveConversationDurationSec(startedAt: Date, endedAt: Date | null, fallbackEndedAt: Date): number {
  const finalEndedAt = endedAt ?? fallbackEndedAt
  return Math.max(0, Math.round((finalEndedAt.getTime() - startedAt.getTime()) / 1000))
}

export default async function ConversationEndedPage({ params }: ConversationEndedPageProps) {
  const { conversationId } = await params
  const userId = await requireSessionUserIdFromCookies()
  const transcript = await getConversationTranscript({
    conversationId,
    userId,
  })

  if (!transcript) {
    notFound()
  }

  const fallbackEndedAt = transcript.messages.at(-1)?.createdAt ?? new Date()
  const totalDurationSec = resolveConversationDurationSec(transcript.startedAt, transcript.endedAt, fallbackEndedAt)
  const limitLabel =
    typeof transcript.durationLimitSec === 'number' ? `${transcript.durationLimitSec} sec` : 'not configured'

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-4 p-4 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Conversation Ended</CardTitle>
          <CardDescription>
            The time limit has been reached. Below is the full transcript with timestamps and speaker roles.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <div className="rounded border bg-muted/30 p-3">
            Started: {dateTimeFormatter.format(transcript.startedAt)}
          </div>
          <div className="rounded border bg-muted/30 p-3">
            Ended: {dateTimeFormatter.format(transcript.endedAt ?? fallbackEndedAt)}
          </div>
          <div className="rounded border bg-muted/30 p-3">Total duration: {totalDurationSec} sec</div>
          <div className="rounded border bg-muted/30 p-3">Configured limit: {limitLabel}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
          <CardDescription>
            Conversation ID: <span className="font-mono text-xs">{transcript.conversationId}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {transcript.messages.length === 0 ? (
            <p className="rounded border bg-muted/30 p-3 text-sm text-muted-foreground">
              No messages were saved for this conversation.
            </p>
          ) : (
            transcript.messages.map(message => (
              <article className="rounded border p-3" key={message.id}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <Badge variant={roleVariant(message.role)}>{roleLabel(message.role)}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    {timeFormatter.format(message.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{message.content}</p>
              </article>
            ))
          )}
        </CardContent>
      </Card>
    </main>
  )
}
