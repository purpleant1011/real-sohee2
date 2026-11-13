export type EncryptedChannelCredential = Readonly<{
  ciphertext: string
  iv: string
  algorithm: 'AES-GCM-256'
}>

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function decodeBase64Url(value: string): Uint8Array {
  try {
    const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
  } catch {
    return new Uint8Array()
  }
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}

async function importKey(encodedKey: string): Promise<CryptoKey> {
  const bytes = decodeBase64Url(encodedKey)
  if (bytes.byteLength !== 32) throw new Error('채널 자격 증명 암호화 키를 확인해 주세요.')
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(bytes).buffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptChannelCredential(
  plaintext: string,
  encodedKey: string,
): Promise<EncryptedChannelCredential> {
  if (plaintext.length < 1 || plaintext.length > 4096) {
    throw new Error('채널 자격 증명을 확인해 주세요.')
  }
  const key = await importKey(encodedKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: Uint8Array.from(iv).buffer },
    key,
    encoder.encode(plaintext),
  )
  return Object.freeze({ ciphertext: encodeBase64Url(ciphertext), iv: encodeBase64Url(iv), algorithm: 'AES-GCM-256' })
}

export async function decryptChannelCredential(
  encrypted: EncryptedChannelCredential,
  encodedKey: string,
): Promise<string> {
  try {
    if (encrypted.algorithm !== 'AES-GCM-256') throw new Error('algorithm')
    const key = await importKey(encodedKey)
    const iv = decodeBase64Url(encrypted.iv)
    const ciphertext = decodeBase64Url(encrypted.ciphertext)
    if (iv.byteLength !== 12 || ciphertext.byteLength < 17) throw new Error('ciphertext')
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Uint8Array.from(iv).buffer },
      key,
      Uint8Array.from(ciphertext).buffer,
    )
    const result = decoder.decode(plaintext)
    if (result.length < 1 || result.length > 4096) throw new Error('plaintext')
    return result
  } catch {
    throw new Error('채널 자격 증명을 열 수 없습니다.')
  }
}
