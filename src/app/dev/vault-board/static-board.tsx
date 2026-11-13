'use client'

import { use } from 'react'
import { createStaticVaultFetch } from '@/features/vault/ui/board/static-vault-api'
import { VaultBoard } from '@/features/vault/ui/board/vault-board'
import { sampleFixtures, samples } from './samples'

export type StaticBoardSearchParams = { open?: string | string[]; item?: string | string[] }

const staticFetch = createStaticVaultFetch(sampleFixtures)
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

/** `?open=preview` or `?open=bundle` (optionally `&item=sample-one|sample-two|sample-three`) starts with the sheet already open. */
function openFrom(params: StaticBoardSearchParams | undefined): { kind: 'preview' | 'bundle'; itemRef: string } | undefined {
  const kind = first(params?.open)
  if (kind !== 'preview' && kind !== 'bundle') return undefined
  const requested = first(params?.item)
  const fallback = kind === 'bundle' ? 'sample-two' : 'sample-one'
  return { kind, itemRef: requested && requested in sampleFixtures.details ? requested : fallback }
}

export function StaticVaultBoard({ searchParams }: { searchParams?: Promise<StaticBoardSearchParams> }) {
  const params = searchParams ? use(searchParams) : undefined
  return <VaultBoard initialData={samples} fetchFn={staticFetch} initialOpen={openFrom(params)} />
}
