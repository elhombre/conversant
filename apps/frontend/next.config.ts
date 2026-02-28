import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@conversant/backend-core', '@conversant/conversation-engine'],
}

export default nextConfig
