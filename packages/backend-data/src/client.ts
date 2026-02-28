import { isProductionEnv } from '@conversant/config'
import { PrismaClient } from './generated/prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (!isProductionEnv()) {
  globalForPrisma.prisma = prisma
}
