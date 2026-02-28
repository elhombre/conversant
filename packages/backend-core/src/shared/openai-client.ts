import OpenAI from 'openai'

export type OpenAIProviderConfig = {
  apiKey: string
  baseURL?: string
}

export function getOpenAIProviderConfig(env: NodeJS.ProcessEnv = process.env): OpenAIProviderConfig | null {
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    return null
  }

  const baseURL = env.OPENAI_BASE_URL?.trim()
  return {
    apiKey,
    baseURL: baseURL && baseURL.length > 0 ? baseURL : undefined,
  }
}

export function createOpenAIClient(config: OpenAIProviderConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  })
}
