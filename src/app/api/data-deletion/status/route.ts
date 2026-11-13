export const dynamic = 'force-dynamic';
import type { DataDeletionRequestStatus } from '@/features/data-deletion/repository'

type Dependencies = Readonly<{
  findStatus(input: { confirmationCode: string }): Promise<DataDeletionRequestStatus | null>
}>

export function createDataDeletionStatusGetHandler(dependencies: Dependencies) {
  return async function get(request: Request) {
    const confirmationCode = new URL(request.url).searchParams.get('code') ?? ''
    try {
      const status = await dependencies.findStatus({ confirmationCode })
      if (!status) return new Response('Not Found', { status: 404 })
      return Response.json({
        status: status.status,
        confirmation_code: confirmationCode,
        requested_at: status.requestedAt,
        updated_at: status.updatedAt,
        completed_at: status.completedAt,
      }, { headers: { 'cache-control': 'no-store, max-age=0' } })
    } catch {
      return new Response('Unavailable', { status: 503 })
    }
  }
}

const production = createDataDeletionStatusGetHandler({
  async findStatus(input) {
    const { getDataDeletionRequestStatus } = await import('@/features/data-deletion/repository')
    return getDataDeletionRequestStatus(input)
  },
})

export const GET = production
