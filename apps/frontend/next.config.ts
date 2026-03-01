import { createRequire } from 'node:module'
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
}

export default withNextIntl(nextConfig)
