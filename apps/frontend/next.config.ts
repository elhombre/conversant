import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@conversant/api-contracts', '@conversant/backend-core', '@conversant/conversation-engine'],
}

export default nextConfig
