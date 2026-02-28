export function jsonError<TCode extends string>(status: number, turnId: string | null, code: TCode, message: string) {
  return Response.json(
    {
      turnId,
      error: {
        code,
        message,
      },
    },
    {
      status,
      headers: {
        'cache-control': 'no-store',
      },
    },
  )
}
