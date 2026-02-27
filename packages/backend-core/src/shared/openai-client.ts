import type { OpenAIProviderEnv } from '@conversant/config'
import OpenAI from 'openai'

export function createOpenAIClient(config: OpenAIProviderEnv): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  })
}
