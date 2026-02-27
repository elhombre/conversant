import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Conversant',
  description: 'Voice UX research app',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
