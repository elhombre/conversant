import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { Toaster } from 'sonner'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { UI_MESSAGES } from '@/i18n/messages'
import { resolveRequestLocale } from '@/i18n/server-locale'
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
  const locale = await resolveRequestLocale()
  const messages = UI_MESSAGES[locale]

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            {children}
            <Toaster richColors position="bottom-right" />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
