import { createHmac, randomBytes } from 'node:crypto'
import { readInviteAdminSecret, readInviteSessionEnv } from '@conversant/config'
import { prisma } from './client'

const DEFAULT_INVITE_TTL_HOURS = 24 * 7
const PUBLIC_ACCESS_PROVIDER_USER_ID = 'public-access'

export type InviteConsumeFailureReason =
  | 'invalid_token'
  | 'token_used'
  | 'token_expired'
  | 'token_revoked'
  | 'misconfigured'

export type InviteConsumeResult =
  | {
      ok: true
      inviteId: string
      userId: string
      conversationMaxDurationSec: number | null
      sessionToken: string
      sessionExpiresAt: Date
    }
  | {
      ok: false
      reason: InviteConsumeFailureReason
    }

type InviteTokenData = {
  id: string
  tokenHash: string
  expiresAt: Date
  conversationMaxDurationSec: number | null
  maxUses: number
  usesCount: number
  usedAt: Date | null
  revokedAt: Date | null
}

export type SessionUser = {
  userId: string
  conversationMaxDurationSec: number | null
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return Math.floor(value)
}

function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex')
}

function validateInvite(invite: InviteTokenData | null, now: Date): InviteConsumeFailureReason | null {
  if (!invite) {
    return 'invalid_token'
  }

  if (invite.revokedAt) {
    return 'token_revoked'
  }

  if (invite.maxUses <= invite.usesCount) {
    return 'token_used'
  }

  if (invite.usesCount === 0 && invite.expiresAt.getTime() <= now.getTime()) {
    return 'token_expired'
  }

  return null
}

export async function issueInviteToken(
  options: {
    ttlHours?: number
    maxUses?: number
    conversationMaxDurationSec?: number | null
    note?: string | null
    createdByUserId?: string | null
  } = {},
) {
  const adminSecret = readInviteAdminSecret()
  if (!adminSecret) {
    throw new Error('INVITE_ADMIN_SECRET is required to issue invite links')
  }

  const ttlHours =
    typeof options.ttlHours === 'number' && Number.isFinite(options.ttlHours) && options.ttlHours > 0
      ? options.ttlHours
      : DEFAULT_INVITE_TTL_HOURS
  const maxUses =
    typeof options.maxUses === 'number' && Number.isFinite(options.maxUses) && options.maxUses > 0
      ? Math.floor(options.maxUses)
      : 1
  const conversationMaxDurationSec = normalizePositiveInteger(options.conversationMaxDurationSec)

  const nowMs = Date.now()
  const expiresAt = new Date(nowMs + ttlHours * 60 * 60 * 1000)
  const inviteToken = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(inviteToken, adminSecret)

  const invite = await prisma.inviteToken.create({
    data: {
      tokenHash,
      expiresAt,
      maxUses,
      conversationMaxDurationSec,
      note: options.note ?? null,
      createdByUserId: options.createdByUserId ?? null,
    },
  })

  return {
    inviteId: invite.id,
    token: inviteToken,
    expiresAt,
    maxUses: invite.maxUses,
    conversationMaxDurationSec: invite.conversationMaxDurationSec,
  }
}

export async function consumeInviteToken(rawToken: string): Promise<InviteConsumeResult> {
  const inviteSessionEnv = readInviteSessionEnv()
  if (!inviteSessionEnv) {
    return {
      ok: false,
      reason: 'misconfigured',
    }
  }

  const token = rawToken.trim()
  if (token.length === 0) {
    return {
      ok: false,
      reason: 'invalid_token',
    }
  }

  const now = new Date()
  const tokenHash = hashToken(token, inviteSessionEnv.inviteAdminSecret)
  const sessionToken = randomBytes(32).toString('base64url')
  const sessionTokenHash = hashToken(sessionToken, inviteSessionEnv.sessionSecret)
  const sessionExpiresAt = new Date(now.getTime() + inviteSessionEnv.sessionTtlHours * 60 * 60 * 1000)

  return prisma.$transaction(async tx => {
    const invite = await tx.inviteToken.findUnique({
      where: {
        tokenHash,
      },
      select: {
        id: true,
        tokenHash: true,
        expiresAt: true,
        conversationMaxDurationSec: true,
        maxUses: true,
        usesCount: true,
        usedAt: true,
        revokedAt: true,
      },
    })

    const invalidReason = validateInvite(invite, now)
    if (invalidReason) {
      return {
        ok: false,
        reason: invalidReason,
      } satisfies InviteConsumeResult
    }
    if (!invite) {
      return {
        ok: false,
        reason: 'invalid_token',
      } satisfies InviteConsumeResult
    }

    const claim = await tx.inviteToken.updateMany({
      where: {
        id: invite.id,
        revokedAt: null,
        usesCount: {
          lt: invite.maxUses,
        },
        OR: [
          {
            usesCount: {
              gt: 0,
            },
          },
          {
            expiresAt: {
              gt: now,
            },
          },
        ],
      },
      data: {
        usesCount: {
          increment: 1,
        },
        usedAt: now,
      },
    })

    if (claim.count !== 1) {
      const latest = await tx.inviteToken.findUnique({
        where: {
          tokenHash,
        },
        select: {
          id: true,
          tokenHash: true,
          expiresAt: true,
          conversationMaxDurationSec: true,
          maxUses: true,
          usesCount: true,
          usedAt: true,
          revokedAt: true,
        },
      })

      const latestReason = validateInvite(latest, now)
      return {
        ok: false,
        reason: latestReason ?? 'token_used',
      } satisfies InviteConsumeResult
    }

    const user = await tx.user.create({
      data: {
        lastSeenAt: now,
      },
      select: {
        id: true,
      },
    })

    await tx.authIdentity.create({
      data: {
        userId: user.id,
        provider: 'invite',
        providerUserId: `${invite.id}:${user.id}`,
      },
    })

    await tx.session.create({
      data: {
        userId: user.id,
        tokenHash: sessionTokenHash,
        expiresAt: sessionExpiresAt,
        conversationMaxDurationSec: invite.conversationMaxDurationSec,
      },
    })

    await tx.inviteToken.update({
      where: {
        id: invite.id,
      },
      data: {
        usedByUserId: user.id,
      },
    })

    return {
      ok: true,
      inviteId: invite.id,
      userId: user.id,
      conversationMaxDurationSec: invite.conversationMaxDurationSec,
      sessionToken,
      sessionExpiresAt,
    } satisfies InviteConsumeResult
  })
}

export async function consumeSessionPageAccess(token: string): Promise<SessionUser | null> {
  const inviteSessionEnv = readInviteSessionEnv()
  if (!inviteSessionEnv) {
    return null
  }

  const normalizedToken = token.trim()
  if (normalizedToken.length === 0) {
    return null
  }

  const tokenHash = hashToken(normalizedToken, inviteSessionEnv.sessionSecret)
  const now = new Date()

  return prisma.$transaction(async tx => {
    const session = await tx.session.findUnique({
      where: {
        tokenHash,
      },
      select: {
        id: true,
        userId: true,
        conversationMaxDurationSec: true,
        revokedAt: true,
        expiresAt: true,
        entryConsumedAt: true,
      },
    })

    if (!session) {
      return null
    }

    if (session.revokedAt || session.expiresAt.getTime() <= now.getTime() || session.entryConsumedAt) {
      return null
    }

    const claimed = await tx.session.updateMany({
      where: {
        id: session.id,
        revokedAt: null,
        entryConsumedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      data: {
        entryConsumedAt: now,
        lastSeenAt: now,
      },
    })

    if (claimed.count !== 1) {
      return null
    }

    await tx.user.update({
      where: {
        id: session.userId,
      },
      data: {
        lastSeenAt: now,
      },
    })

    return {
      userId: session.userId,
      conversationMaxDurationSec: session.conversationMaxDurationSec,
    }
  })
}

export async function resolveSessionUser(token: string): Promise<SessionUser | null> {
  const inviteSessionEnv = readInviteSessionEnv()
  if (!inviteSessionEnv) {
    return null
  }

  const normalizedToken = token.trim()
  if (normalizedToken.length === 0) {
    return null
  }

  const tokenHash = hashToken(normalizedToken, inviteSessionEnv.sessionSecret)
  const now = new Date()

  const session = await prisma.session.findUnique({
    where: {
      tokenHash,
    },
    select: {
      id: true,
      userId: true,
      conversationMaxDurationSec: true,
      revokedAt: true,
      expiresAt: true,
    },
  })

  if (!session) {
    return null
  }

  if (session.revokedAt || session.expiresAt.getTime() <= now.getTime()) {
    return null
  }

  await prisma.session.update({
    where: {
      id: session.id,
    },
    data: {
      lastSeenAt: now,
    },
  })

  await prisma.user.update({
    where: {
      id: session.userId,
    },
    data: {
      lastSeenAt: now,
    },
  })

  return {
    userId: session.userId,
    conversationMaxDurationSec: session.conversationMaxDurationSec,
  }
}

export async function revokeSessionByToken(token: string): Promise<void> {
  const inviteSessionEnv = readInviteSessionEnv()
  if (!inviteSessionEnv) {
    return
  }

  const normalizedToken = token.trim()
  if (normalizedToken.length === 0) {
    return
  }

  const tokenHash = hashToken(normalizedToken, inviteSessionEnv.sessionSecret)
  await prisma.session.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  })
}

export async function resolveOrCreatePublicAccessUser(): Promise<{ userId: string }> {
  const now = new Date()

  return prisma.$transaction(async tx => {
    const existing = await tx.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'authjs',
          providerUserId: PUBLIC_ACCESS_PROVIDER_USER_ID,
        },
      },
      select: {
        userId: true,
      },
    })

    if (existing) {
      await tx.user.update({
        where: {
          id: existing.userId,
        },
        data: {
          lastSeenAt: now,
        },
      })

      return {
        userId: existing.userId,
      }
    }

    const user = await tx.user.create({
      data: {
        lastSeenAt: now,
      },
      select: {
        id: true,
      },
    })

    await tx.authIdentity.create({
      data: {
        userId: user.id,
        provider: 'authjs',
        providerUserId: PUBLIC_ACCESS_PROVIDER_USER_ID,
      },
    })

    return {
      userId: user.id,
    }
  })
}
