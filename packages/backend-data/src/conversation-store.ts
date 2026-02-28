import { prisma } from './client'
import type { MessageRole } from './generated/prisma/client'

const MAX_HISTORY_MESSAGES = 24

export type ConversationMessageRecord = {
  role: 'user' | 'assistant'
  content: string
}

export type ConversationScopeRecord = {
  conversationId: string
  userId?: string
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

function mapMessageRole(role: MessageRole): 'user' | 'assistant' | null {
  if (role === 'user' || role === 'assistant') {
    return role
  }

  return null
}

function assertUserScope(scope: ConversationScopeRecord): string {
  if (!scope.userId || scope.userId.length === 0) {
    throw new Error('Conversation persistence requires userId scope')
  }

  return scope.userId
}

export function createPrismaConversationStore(): ConversationStoreRecord {
  return {
    async getHistory(scope) {
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

      await prisma.$transaction(async tx => {
        const conversation = await tx.conversation.upsert({
          where: {
            id: scope.conversationId,
          },
          create: {
            id: scope.conversationId,
            userId,
          },
          update: {},
          select: {
            userId: true,
          },
        })

        if (conversation.userId !== userId) {
          throw new Error('Conversation scope does not match session user')
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
