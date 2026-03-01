'use client'

import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const ERROR_LABELS: Record<string, string> = {
  invalid: 'Invite token is invalid.',
  used: 'Invite usage limit reached.',
  expired: 'Invite link has expired.',
  revoked: 'Invite link was revoked.',
  misconfigured: 'Invite auth is not configured on server.',
}

export default function InviteRequiredPage() {
  const searchParams = useSearchParams()
  const authError = searchParams.get('auth_error')
  const errorText = authError ? ERROR_LABELS[authError] : null

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center p-4 md:p-8">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Invite Required</CardTitle>
          <CardDescription>This demo is private. Open a valid invite link to start a session.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {errorText ? (
            <p className="rounded border border-destructive/40 bg-destructive/10 p-3 text-destructive">{errorText}</p>
          ) : null}
          <p className="text-muted-foreground">
            Ask the project owner for an invite URL, then open it in this browser.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
