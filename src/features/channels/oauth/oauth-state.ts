import { z } from 'zod'
import { decryptChannelCredential, encryptChannelCredential } from '@/lib/security/channel-credential-crypto'

const stateSchema = z.object({
  channel: z.enum(['instagram', 'threads']),
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  state: z.string().min(32).max(200),
  expiresAt: z.string().datetime({ offset: true }),
  returnPath: z.string().optional(),
  returnOrigin: z.enum(['https://example.com', 'https://m.example.com', 'https://www.example.com']).optional(),
}).strict()

export type OAuthStateContext = z.infer<typeof stateSchema>

const createFailure = '채널 연결 요청을 만들지 못했습니다.'
const openFailure = '채널 연결 요청이 만료되었거나 올바르지 않습니다.'

export async function oauthStateDigest(state: string): Promise<string> {
  if (state.length < 32 || state.length > 200) throw new Error(createFailure)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state))
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export async function sealOAuthState(input: OAuthStateContext, encodedKey: string): Promise<string> {
  const parsed = stateSchema.safeParse(input)
  if (!parsed.success) throw new Error(createFailure)
  try {
    const encrypted = await encryptChannelCredential(JSON.stringify(parsed.data), encodedKey)
    return `${encrypted.iv}.${encrypted.ciphertext}`
  } catch {
    throw new Error(createFailure)
  }
}

export async function openOAuthState(
  sealed: string,
  encodedKey: string,
  now: Date = new Date(),
): Promise<OAuthStateContext> {
  try {
    const [iv, ciphertext, extra] = sealed.split('.')
    if (!iv || !ciphertext || extra || sealed.length > 12_000) throw new Error('shape')
    const plaintext = await decryptChannelCredential({ iv, ciphertext, algorithm: 'AES-GCM-256' }, encodedKey)
    const parsed = stateSchema.parse(JSON.parse(plaintext))
    if (new Date(parsed.expiresAt).getTime() <= now.getTime()) throw new Error('expired')
    return Object.freeze(parsed)
  } catch {
    throw new Error(openFailure)
  }
}
