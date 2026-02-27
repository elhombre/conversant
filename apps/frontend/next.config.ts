import { createRequire } from 'node:module'
import path from 'node:path'
import type { NextConfig } from 'next'

const require = createRequire(import.meta.url)

type CreateNextIntlPlugin = (requestConfigPath?: string) => (config: NextConfig) => NextConfig

const createNextIntlPlugin: CreateNextIntlPlugin = require(
  require.resolve('next-intl/plugin', {
    paths: [process.cwd()],
  }),
)

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  transpilePackages: [
    '@conversant/api-contracts',
    '@conversant/backend-core',
    '@conversant/backend-data',
    '@conversant/config',
    '@conversant/conversation-engine',
  ],
  outputFileTracingRoot: path.join(process.cwd(), '../../'),
  outputFileTracingIncludes: {
    '/**/*': ['../../packages/backend-data/src/generated/prisma/**/*'],
  },
}

export default withNextIntl(nextConfig)
