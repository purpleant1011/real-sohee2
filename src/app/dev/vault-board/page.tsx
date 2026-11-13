import { notFound } from 'next/navigation'
import { StaticVaultBoard, type StaticBoardSearchParams } from './static-board'

export const dynamic = 'force-dynamic'

export default function VaultBoardPreviewPage({ searchParams }: { searchParams?: Promise<StaticBoardSearchParams> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  return <main className="min-w-0 bg-background px-4 py-8 sm:px-8"><StaticVaultBoard searchParams={searchParams} /></main>
}
