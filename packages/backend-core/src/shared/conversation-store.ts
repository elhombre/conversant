export type ConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ConversationStore = {
  getHistory: (conversationId: string) => ConversationMessage[]
  appendTurn: (conversationId: string, userText: string, assistantText: string) => void
  clearConversation: (conversationId: string) => void
}

const MAX_HISTORY_MESSAGES = 24

class InMemoryConversationStore implements ConversationStore {
  private readonly messagesByConversation = new Map<string, ConversationMessage[]>()

  getHistory(conversationId: string): ConversationMessage[] {
    const history = this.messagesByConversation.get(conversationId)
    return history ? [...history] : []
  }

  appendTurn(conversationId: string, userText: string, assistantText: string) {
    const nextHistory = [
      ...this.getHistory(conversationId),
      {
        role: 'user' as const,
        content: userText,
      },
      {
        role: 'assistant' as const,
        content: assistantText,
      },
    ]

    const trimmed = nextHistory.slice(-MAX_HISTORY_MESSAGES)
    this.messagesByConversation.set(conversationId, trimmed)
  }

  clearConversation(conversationId: string) {
    this.messagesByConversation.delete(conversationId)
  }
}

const sharedConversationStore = new InMemoryConversationStore()

export function getConversationStore(): ConversationStore {
  return sharedConversationStore
}
