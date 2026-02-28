import { createHmac, randomBytes } from 'node:crypto'
import { readInviteAdminSecret, readInviteSessionEnv } from '@conversant/config'
import { prisma } from './client'

const DEFAULT_INVITE_TTL_HOURS = 24 * 7

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
  usedAt: Date | null
  revokedAt: Date | null
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

  if (invite.usedAt) {
    return 'token_used'
  }

  if (invite.expiresAt.getTime() <= now.getTime()) {
    return 'token_expired'
  }

  return null
}

export async function issueInviteToken(
  options: { ttlHours?: number; note?: string | null; createdByUserId?: string | null } = {},
) {
  const adminSecret = readInviteAdminSecret()
  if (!adminSecret) {
    throw new Error('INVITE_ADMIN_SECRET is required to issue invite links')
  }

  const ttlHours =
    typeof options.ttlHours === 'number' && Number.isFinite(options.ttlHours) && options.ttlHours > 0
      ? options.ttlHours
      : DEFAULT_INVITE_TTL_HOURS

  const nowMs = Date.now()
  const expiresAt = new Date(nowMs + ttlHours * 60 * 60 * 1000)
  const inviteToken = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(inviteToken, adminSecret)

  const invite = await prisma.inviteToken.create({
    data: {
      tokenHash,
      expiresAt,
      note: options.note ?? null,
      createdByUserId: options.createdByUserId ?? null,
    },
  })

  return {
    inviteId: invite.id,
    token: inviteToken,
    expiresAt,
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
        usedAt: null,
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      data: {
        usedAt: now,
      },
    })

    if (claim.count !== 1) {
      return {
        ok: false,
        reason: 'token_used',
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
        providerUserId: invite.id,
      },
    })

    await tx.session.create({
      data: {
        userId: user.id,
        tokenHash: sessionTokenHash,
        expiresAt: sessionExpiresAt,
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
      sessionToken,
      sessionExpiresAt,
    } satisfies InviteConsumeResult
  })
}

export async function consumeSessionPageAccess(token: string): Promise<{ userId: string } | null> {
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
    }
  })
}

export async function resolveSessionUser(token: string): Promise<{ userId: string } | null> {
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
