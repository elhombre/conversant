import { readAssistantRuntimeEnv } from '@conversant/config'

export type ConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ConversationScope = {
  conversationId: string
  userId?: string
}

export type ConversationTurn = {
  turnId: string
  userText: string
  assistantText: string
  assistantModel?: string
  assistantLatencyMs?: number
}

export type ConversationStore = {
  getHistory: (scope: ConversationScope) => Promise<ConversationMessage[]>
  appendTurn: (scope: ConversationScope, turn: ConversationTurn) => Promise<void>
  clearConversation: (scope: ConversationScope) => Promise<void>
}

const MAX_HISTORY_MESSAGES = 24

class InMemoryConversationStore implements ConversationStore {
  private readonly messagesByConversation = new Map<string, ConversationMessage[]>()
  private readonly startedAtByConversation = new Map<string, number>()

  private isConversationExpired(scope: ConversationScope): boolean {
    const configuredLimitSec = readAssistantRuntimeEnv().conversationMaxDurationSec
    if (configuredLimitSec === null) {
      return false
    }

    const startedAt = this.startedAtByConversation.get(this.getConversationKey(scope))
    if (typeof startedAt !== 'number') {
      return false
    }

    return Date.now() - startedAt >= configuredLimitSec * 1000
  }

  private throwIfExpired(scope: ConversationScope): void {
    if (!this.isConversationExpired(scope)) {
      return
    }

    const error = new Error('Conversation time limit reached.') as Error & { code?: string }
    error.code = 'ConversationExpired'
    throw error
  }

  private getConversationKey(scope: ConversationScope): string {
    return scope.userId ? `${scope.userId}:${scope.conversationId}` : scope.conversationId
  }

  async getHistory(scope: ConversationScope): Promise<ConversationMessage[]> {
    this.throwIfExpired(scope)
    const history = this.messagesByConversation.get(this.getConversationKey(scope))
    return history ? [...history] : []
  }

  async appendTurn(scope: ConversationScope, turn: ConversationTurn): Promise<void> {
    this.throwIfExpired(scope)
    const key = this.getConversationKey(scope)
    if (!this.startedAtByConversation.has(key)) {
      this.startedAtByConversation.set(key, Date.now())
    }

    const nextHistory = [
      ...(await this.getHistory(scope)),
      {
        role: 'user' as const,
        content: turn.userText,
      },
      {
        role: 'assistant' as const,
        content: turn.assistantText,
      },
    ]

    const trimmed = nextHistory.slice(-MAX_HISTORY_MESSAGES)
    this.messagesByConversation.set(key, trimmed)
  }

  async clearConversation(scope: ConversationScope): Promise<void> {
    const key = this.getConversationKey(scope)
    this.messagesByConversation.delete(key)
    this.startedAtByConversation.delete(key)
  }
}

const sharedConversationStore = new InMemoryConversationStore()

export function getConversationStore(): ConversationStore {
  return sharedConversationStore
}
