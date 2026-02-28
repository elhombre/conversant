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

  private getConversationKey(scope: ConversationScope): string {
    return scope.userId ? `${scope.userId}:${scope.conversationId}` : scope.conversationId
  }

  async getHistory(scope: ConversationScope): Promise<ConversationMessage[]> {
    const history = this.messagesByConversation.get(this.getConversationKey(scope))
    return history ? [...history] : []
  }

  async appendTurn(scope: ConversationScope, turn: ConversationTurn): Promise<void> {
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
    this.messagesByConversation.set(this.getConversationKey(scope), trimmed)
  }

  async clearConversation(scope: ConversationScope): Promise<void> {
    this.messagesByConversation.delete(this.getConversationKey(scope))
  }
}

const sharedConversationStore = new InMemoryConversationStore()

export function getConversationStore(): ConversationStore {
  return sharedConversationStore
}
