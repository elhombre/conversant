import { loadRootEnv } from './load-root-env'

export type EnvSource = NodeJS.ProcessEnv

const DEFAULT_SESSION_TTL_HOURS = 24 * 14
const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4o-mini'
const DEFAULT_OPENAI_STT_MODEL = 'gpt-4o-mini-transcribe'
const DEFAULT_OPENAI_STT_LANGUAGE_DETECT_MODEL = 'whisper-1'
const DEFAULT_OPENAI_TTS_MODEL = 'tts-1'
const DEFAULT_INVITE_BASE_URL = 'http://localhost:3000'

function readNonEmptyString(env: EnvSource, key: string): string | null {
  const raw = env[key]
  if (typeof raw !== 'string') {
    return null
  }

  const value = raw.trim()
  return value.length > 0 ? value : null
}

function resolveEnv(env: EnvSource | undefined): EnvSource {
  if (env) {
    return env
  }

  loadRootEnv()
  return process.env
}

function readPositiveInteger(env: EnvSource, key: string, fallback: number): number {
  const raw = readNonEmptyString(env, key)
  if (!raw) {
    return fallback
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed
}

export type OpenAIProviderEnv = {
  apiKey: string
  baseURL?: string
}

export type OpenAIModelEnv = {
  chatModel: string
  sttModel: string
  sttLanguageDetectModel: string
  ttsModel: string
}

export function readOpenAIProviderEnv(env?: EnvSource): OpenAIProviderEnv | null {
  const source = resolveEnv(env)
  const apiKey = readNonEmptyString(source, 'OPENAI_API_KEY')
  if (!apiKey) {
    return null
  }

  const baseURL = readNonEmptyString(source, 'OPENAI_BASE_URL') ?? undefined
  return {
    apiKey,
    baseURL,
  }
}

export function readOpenAIModelEnv(env?: EnvSource): OpenAIModelEnv {
  const source = resolveEnv(env)
  return {
    chatModel: readNonEmptyString(source, 'OPENAI_CHAT_MODEL') ?? DEFAULT_OPENAI_CHAT_MODEL,
    sttModel: readNonEmptyString(source, 'OPENAI_STT_MODEL') ?? DEFAULT_OPENAI_STT_MODEL,
    sttLanguageDetectModel:
      readNonEmptyString(source, 'OPENAI_STT_LANGUAGE_DETECT_MODEL') ?? DEFAULT_OPENAI_STT_LANGUAGE_DETECT_MODEL,
    ttsModel: readNonEmptyString(source, 'OPENAI_TTS_MODEL') ?? DEFAULT_OPENAI_TTS_MODEL,
  }
}

export type InviteSessionEnv = {
  inviteAdminSecret: string
  sessionSecret: string
  sessionTtlHours: number
}

export function readInviteSessionEnv(env?: EnvSource): InviteSessionEnv | null {
  const source = resolveEnv(env)
  const inviteAdminSecret = readNonEmptyString(source, 'INVITE_ADMIN_SECRET')
  const sessionSecret = readNonEmptyString(source, 'SESSION_SECRET')
  if (!inviteAdminSecret || !sessionSecret) {
    return null
  }

  return {
    inviteAdminSecret,
    sessionSecret,
    sessionTtlHours: readPositiveInteger(source, 'SESSION_TTL_HOURS', DEFAULT_SESSION_TTL_HOURS),
  }
}

export function readInviteAdminSecret(env?: EnvSource): string | null {
  const source = resolveEnv(env)
  return readNonEmptyString(source, 'INVITE_ADMIN_SECRET')
}

export function readInviteBaseUrl(env?: EnvSource): string {
  const source = resolveEnv(env)
  return readNonEmptyString(source, 'INVITE_BASE_URL') ?? DEFAULT_INVITE_BASE_URL
}

export function isProductionEnv(env?: EnvSource): boolean {
  const source = resolveEnv(env)
  return readNonEmptyString(source, 'NODE_ENV') === 'production'
}
