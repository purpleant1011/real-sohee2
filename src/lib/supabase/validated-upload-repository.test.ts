import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from './database.types'
import { createValidatedUploadRepository } from './validated-upload-repository'

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(blob)
  })
}

describe('createValidatedUploadRepository', () => {
  it('passes an actual Blob body to Supabase Storage instead of serializing metadata JSON', async () => {
    let requestBody: BodyInit | null | undefined
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body
      return new Response(JSON.stringify({ Key: 'content-media/path/asset.png' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createClient<Database>(
      'https://example.supabase.co',
      'sb_secret_test-only',
      { global: { fetch } },
    )
    const repository = createValidatedUploadRepository(client)
    const fileBody = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
      type: 'image/png',
    })

    await expect(
      repository.uploadObject('content-media', 'path/asset.png', fileBody, {
        contentType: 'image/png',
        upsert: false,
      }),
    ).resolves.toEqual({ error: null })

    expect(fetch).toHaveBeenCalledOnce()
    expect(requestBody).toBeInstanceOf(FormData)
    const uploadedPart = Array.from((requestBody as FormData).values()).find(
      (value) => value instanceof Blob,
    )
    expect(uploadedPart).toBeInstanceOf(Blob)
    expect(await readBlob(uploadedPart as Blob)).toEqual(await readBlob(fileBody))
    expect(requestBody).not.toBe(JSON.stringify({ type: 'image/png', size: 4 }))
  })
})
