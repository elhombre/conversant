import { consumePageAccessFromRequest } from '@/lib/auth/page-access'
import { HomeClient } from './home-client'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  await consumePageAccessFromRequest()
  return <HomeClient />
}
