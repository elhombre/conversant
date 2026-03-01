import { readAssistantRuntimeEnv } from '@conversant/config'
import { prisma } from './client'
import type { MessageRole } from './generated/prisma/client'

const MAX_HISTORY_MESSAGES = 24
const CONVERSATION_EXPIRED_CODE = 'ConversationExpired'

export type ConversationMessageRecord = {
  role: 'user' | 'assistant'
  content: string
}

export type ConversationScopeRecord = {
  conversationId: string
  userId?: string
  conversationMaxDurationSec?: number | null
}

export type ConversationTurnRecord = {
  turnId: string
  userText: string
  assistantText: string
  assistantModel?: string
  assistantLatencyMs?: number
}

export type ConversationStoreRecord = {
  getHistory: (scope: ConversationScopeRecord) => Promise<ConversationMessageRecord[]>
  appendTurn: (scope: ConversationScopeRecord, turn: ConversationTurnRecord) => Promise<void>
  clearConversation: (scope: ConversationScopeRecord) => Promise<void>
}

export type ConversationTranscriptMessageRecord = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  turnId: string | null
  createdAt: Date
}

export type ConversationTranscriptRecord = {
  conversationId: string
  startedAt: Date
  endedAt: Date | null
  durationLimitSec: number | null
  messages: ConversationTranscriptMessageRecord[]
}

type CodedError = Error & { code?: string }

type ConversationLifetimeRecord = {
  startedAt: Date
  endedAt: Date | null
  durationLimitSec: number | null
}

function mapMessageRole(role: MessageRole): 'user' | 'assistant' | null {
  if (role === 'user' || role === 'assistant') {
    return role
  }

  return null
}

function mapTranscriptRole(role: MessageRole): 'user' | 'assistant' | 'system' {
  if (role === 'user' || role === 'assistant') {
    return role
  }

  return 'system'
}

function assertUserScope(scope: ConversationScopeRecord): string {
  if (!scope.userId || scope.userId.length === 0) {
    throw new Error('Conversation persistence requires userId scope')
  }

  return scope.userId
}

function createConversationExpiredError(): CodedError {
  const error = new Error('Conversation time limit reached.') as CodedError
  error.code = CONVERSATION_EXPIRED_CODE
  return error
}

function resolveDurationLimitSec(
  conversation: ConversationLifetimeRecord,
  fallbackLimitSec: number | null,
): number | null {
  if (typeof conversation.durationLimitSec === 'number' && conversation.durationLimitSec > 0) {
    return conversation.durationLimitSec
  }

  return fallbackLimitSec
}

function resolveScopedDurationLimitSec(scope: ConversationScopeRecord): number | null {
  if (typeof scope.conversationMaxDurationSec === 'number' && scope.conversationMaxDurationSec > 0) {
    return scope.conversationMaxDurationSec
  }

  return readAssistantRuntimeEnv().conversationMaxDurationSec
}

function isConversationExpired(
  conversation: ConversationLifetimeRecord,
  fallbackLimitSec: number | null,
  now: Date,
): boolean {
  const durationLimitSec = resolveDurationLimitSec(conversation, fallbackLimitSec)
  if (durationLimitSec === null) {
    return false
  }

  const elapsedMs = now.getTime() - conversation.startedAt.getTime()
  return elapsedMs >= durationLimitSec * 1000
}

export function createPrismaConversationStore(): ConversationStoreRecord {
  return {
    async getHistory(scope) {
      const configuredDurationLimitSec = resolveScopedDurationLimitSec(scope)
      const conversation = await prisma.conversation.findFirst({
        where: scope.userId
          ? {
              id: scope.conversationId,
              userId: scope.userId,
            }
          : {
              id: scope.conversationId,
            },
        select: {
          id: true,
          startedAt: true,
          endedAt: true,
          durationLimitSec: true,
        },
      })

      if (conversation && isConversationExpired(conversation, configuredDurationLimitSec, new Date())) {
        if (!conversation.endedAt) {
          await prisma.conversation.updateMany({
            where: {
              id: conversation.id,
              endedAt: null,
            },
            data: {
              endedAt: new Date(),
            },
          })
        }
        throw createConversationExpiredError()
      }

      const where = scope.userId
        ? {
            conversationId: scope.conversationId,
            conversation: {
              is: {
                userId: scope.userId,
              },
            },
          }
        : {
            conversationId: scope.conversationId,
          }

      const messages = await prisma.message.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        take: MAX_HISTORY_MESSAGES,
        select: {
          role: true,
          content: true,
        },
      })

      return messages
        .toReversed()
        .map(message => {
          const role = mapMessageRole(message.role)
          if (!role) {
            return null
          }

          return {
            role,
            content: message.content,
          }
        })
        .filter((message): message is ConversationMessageRecord => message !== null)
    },

    async appendTurn(scope, turn) {
      const userId = assertUserScope(scope)
      const configuredDurationLimitSec = resolveScopedDurationLimitSec(scope)

      await prisma.$transaction(async tx => {
        const conversation = await tx.conversation.upsert({
          where: {
            id: scope.conversationId,
          },
          create: {
            id: scope.conversationId,
            userId,
            durationLimitSec: configuredDurationLimitSec,
          },
          update: {},
          select: {
            userId: true,
            startedAt: true,
            endedAt: true,
            durationLimitSec: true,
          },
        })

        if (conversation.userId !== userId) {
          throw new Error('Conversation scope does not match session user')
        }

        if (isConversationExpired(conversation, configuredDurationLimitSec, new Date())) {
          if (!conversation.endedAt) {
            await tx.conversation.updateMany({
              where: {
                id: scope.conversationId,
                endedAt: null,
              },
              data: {
                endedAt: new Date(),
              },
            })
          }
          throw createConversationExpiredError()
        }

        await tx.message.createMany({
          data: [
            {
              conversationId: scope.conversationId,
              role: 'user',
              content: turn.userText,
              turnId: turn.turnId,
            },
            {
              conversationId: scope.conversationId,
              role: 'assistant',
              content: turn.assistantText,
              turnId: turn.turnId,
              model: turn.assistantModel ?? null,
              latencyMs: typeof turn.assistantLatencyMs === 'number' ? turn.assistantLatencyMs : null,
            },
          ],
        })
      })
    },

    async clearConversation(scope) {
      if (scope.userId) {
        await prisma.conversation.deleteMany({
          where: {
            id: scope.conversationId,
            userId: scope.userId,
          },
        })
        return
      }

      await prisma.conversation.deleteMany({
        where: {
          id: scope.conversationId,
        },
      })
    },
  }
}

export async function getConversationTranscript(scope: {
  conversationId: string
  userId: string
}): Promise<ConversationTranscriptRecord | null> {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: scope.conversationId,
      userId: scope.userId,
    },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      durationLimitSec: true,
      messages: {
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          id: true,
          role: true,
          content: true,
          turnId: true,
          createdAt: true,
        },
      },
    },
  })

  if (!conversation) {
    return null
  }

  return {
    conversationId: conversation.id,
    startedAt: conversation.startedAt,
    endedAt: conversation.endedAt,
    durationLimitSec: conversation.durationLimitSec,
    messages: conversation.messages.map(message => ({
      id: message.id,
      role: mapTranscriptRole(message.role),
      content: message.content,
      turnId: message.turnId,
      createdAt: message.createdAt,
    })),
  }
}
