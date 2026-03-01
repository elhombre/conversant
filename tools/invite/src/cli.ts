import { issueInviteToken } from '@conversant/backend-data'
import { loadRootEnv, readInviteBaseUrl } from '@conversant/config'
import { Command, InvalidArgumentError } from 'commander'

type CliOptions = {
  ttlHours?: number
  ttlDays?: number
  maxUses?: number
  note?: string
  baseUrl?: string
}

function readPositiveInteger(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`${optionName} expects a positive integer value`)
  }

  return parsed
}

function parsePositiveInteger(optionName: string) {
  return (value: string) => readPositiveInteger(value, optionName)
}

function buildInviteUrl(baseUrl: string, token: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const url = new URL('/api/auth/invite/consume', normalizedBaseUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

async function runGenerateInvite(options: CliOptions): Promise<void> {
  if (typeof options.ttlHours === 'number' && typeof options.ttlDays === 'number') {
    throw new Error('Use only one TTL option: --ttl-hours or --ttl-days')
  }

  loadRootEnv()

  const baseUrl = options.baseUrl ?? readInviteBaseUrl()
  const ttlHours = typeof options.ttlDays === 'number' ? options.ttlDays * 24 : options.ttlHours

  const issued = await issueInviteToken({
    ttlHours,
    maxUses: options.maxUses,
    note: options.note ?? null,
  })

  const inviteUrl = buildInviteUrl(baseUrl, issued.token)
  process.stdout.write(`invite_id: ${issued.inviteId}\n`)
  process.stdout.write(`expires_at: ${issued.expiresAt.toISOString()}\n`)
  process.stdout.write(`max_uses: ${issued.maxUses}\n`)
  process.stdout.write('uses_count: 0\n')
  process.stdout.write(`uses_left: ${issued.maxUses}\n`)
  process.stdout.write(`invite_url: ${inviteUrl}\n`)
}

async function main(argv: string[]): Promise<void> {
  const program = new Command()
    .name('conversant-invite')
    .description('Generate invite URLs for the Conversant demo.')
    .option('--ttl-hours <hours>', 'Invite lifetime before first use in hours.', parsePositiveInteger('--ttl-hours'))
    .option('--ttl-days <days>', 'Invite lifetime before first use in days.', parsePositiveInteger('--ttl-days'))
    .option(
      '--max-uses <count>',
      'Maximum number of successful invite consumptions.',
      parsePositiveInteger('--max-uses'),
    )
    .option('--note <text>', 'Optional invite note stored in DB.')
    .option('--base-url <url>', 'Base URL for generated consume link.')
    .addHelpText(
      'after',
      '\nExamples:\n  yarn invite:generate -- --ttl-days 365 --max-uses 10 --base-url http://localhost:3000\n  conversant-invite --ttl-hours 24 --max-uses 3',
    )
    .action(async (options: CliOptions) => {
      await runGenerateInvite(options)
    })

  const normalizedArgv = [
    argv[0] ?? 'node',
    argv[1] ?? 'conversant-invite',
    ...argv.slice(2).filter(arg => arg !== '--'),
  ]
  await program.parseAsync(normalizedArgv)
}

void main(process.argv).catch(error => {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const message =
    rawMessage === 'INVITE_ADMIN_SECRET is required to issue invite links'
      ? `${rawMessage}. Define it in the repository root .env or export it before running the script.`
      : rawMessage

  process.stderr.write(`Failed to generate invite: ${message}\n`)
  process.exitCode = 1
})
