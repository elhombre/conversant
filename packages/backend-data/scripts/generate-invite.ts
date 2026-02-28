import { issueInviteToken } from '../src/auth'
import { loadInviteEnv } from './load-env'

type Args = {
  ttlHours?: number
  note?: string
  baseUrl?: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index]
    if (entry === '--ttl-hours') {
      const value = argv[index + 1]
      if (typeof value === 'string' && value.length > 0) {
        const parsed = Number.parseInt(value, 10)
        if (Number.isFinite(parsed) && parsed > 0) {
          args.ttlHours = parsed
        }
      }
      index += 1
      continue
    }

    if (entry === '--note') {
      const value = argv[index + 1]
      if (typeof value === 'string' && value.length > 0) {
        args.note = value
      }
      index += 1
      continue
    }

    if (entry === '--base-url') {
      const value = argv[index + 1]
      if (typeof value === 'string' && value.length > 0) {
        args.baseUrl = value
      }
      index += 1
    }
  }

  return args
}

function buildInviteUrl(baseUrl: string, token: string) {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const url = new URL('/api/auth/invite/consume', normalizedBaseUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

async function main() {
  loadInviteEnv()

  const args = parseArgs(process.argv.slice(2))
  const baseUrl = args.baseUrl ?? process.env.INVITE_BASE_URL ?? 'http://localhost:3000'

  const issued = await issueInviteToken({
    ttlHours: args.ttlHours,
    note: args.note ?? null,
  })

  const inviteUrl = buildInviteUrl(baseUrl, issued.token)
  process.stdout.write(`invite_id: ${issued.inviteId}\n`)
  process.stdout.write(`expires_at: ${issued.expiresAt.toISOString()}\n`)
  process.stdout.write(`invite_url: ${inviteUrl}\n`)
}

void main().catch(error => {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const message =
    rawMessage === 'INVITE_ADMIN_SECRET is required to issue invite links'
      ? `${rawMessage}. Define it in packages/backend-data/.env or export it before running the script.`
      : rawMessage

  process.stderr.write(`Failed to generate invite: ${message}\n`)
  process.exitCode = 1
})
