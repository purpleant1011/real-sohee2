import type { VaultCopyBundle } from '@/features/vault/bundle/types'
import type { VaultItemDetailDto } from '@/features/vault/query/types'
import type { VaultFetch } from './vault-api'

export type StaticVaultFixtures = {
  details: Readonly<Record<string, VaultItemDetailDto>>
  bundles: Readonly<Record<string, VaultCopyBundle>>
}

const READ_ONLY_MESSAGE = '미리보기 샘플이라 저장되지 않아요.'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/**
 * Serves the sheet and the copy dialog from fixtures for the development page. It never touches the network,
 * and every write is refused with a plain Korean message, so the page cannot be mistaken for real saved data.
 */
export function createStaticVaultFetch({ details, bundles }: StaticVaultFixtures): VaultFetch {
  return async (input, init) => {
    const url = new URL(String(input), 'http://static.invalid')
    const match = /\/vault\/([^/]+)(\/bundle)?$/.exec(url.pathname)
    if (!match) return json({ success: false, error: '샘플에 없는 요청이에요.' }, 404)
    const ref = decodeURIComponent(match[1])
    if ((init?.method ?? 'GET') !== 'GET') return json({ error: READ_ONLY_MESSAGE }, 409)
    if (match[2]) {
      const bundle = bundles[ref]
      return bundle ? json(bundle) : json({ error: '샘플에 없는 글이에요.' }, 404)
    }
    const detail = details[ref]
    return detail ? json({ success: true, data: detail }) : json({ success: false, error: '샘플에 없는 글이에요.' }, 404)
  }
}
