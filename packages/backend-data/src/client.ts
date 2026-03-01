import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { isProductionEnv } from '@conversant/config'
import { PrismaClient } from './generated/prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
}

const PRISMA_ENGINE_FILE = 'libquery_engine-rhel-openssl-3.0.x.so.node'

function tryFindEngineRecursively(rootDir: string, fileName: string, maxDepth: number): string | null {
  const stack: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = []
    try {
      entries = readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name)
      if (entry.isFile() && entry.name === fileName) {
        return fullPath
      }

      if (!entry.isDirectory() || current.depth >= maxDepth) {
        continue
      }

      stack.push({ dir: fullPath, depth: current.depth + 1 })
    }
  }

  return null
}

function resolvePrismaEnginePath(): string | null {
  const directCandidates = [
    path.join(process.cwd(), 'apps/frontend/.next/server/chunks', PRISMA_ENGINE_FILE),
    path.join(process.cwd(), 'packages/backend-data/src/generated/prisma', PRISMA_ENGINE_FILE),
    path.join('/var/task/apps/frontend/.next/server/chunks', PRISMA_ENGINE_FILE),
    path.join('/var/task/packages/backend-data/src/generated/prisma', PRISMA_ENGINE_FILE),
    path.join('/vercel/path0/packages/backend-data/src/generated/prisma', PRISMA_ENGINE_FILE),
  ]

  for (const candidate of directCandidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  const searchRoots = ['/var/task', '/vercel/path0']
  for (const root of searchRoots) {
    const foundPath = tryFindEngineRecursively(root, PRISMA_ENGINE_FILE, 8)
    if (foundPath) {
      return foundPath
    }
  }

  return null
}

if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  const enginePath = resolvePrismaEnginePath()
  if (enginePath) {
    process.env.PRISMA_QUERY_ENGINE_LIBRARY = enginePath
  }
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (!isProductionEnv()) {
  globalForPrisma.prisma = prisma
}
