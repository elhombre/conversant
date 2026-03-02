import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import { UiSettingsProvider } from '@/components/providers/ui-settings-provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'Conversant',
  description: 'Voice UX research app',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <UiSettingsProvider>
          {children}
          <Toaster richColors position="bottom-right" />
        </UiSettingsProvider>
      </body>
    </html>
  )
}
