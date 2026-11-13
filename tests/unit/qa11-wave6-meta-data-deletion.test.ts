import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createHmac } from 'node:crypto'
import { createProviderDeletionPostHandler } from '@/app/api/channels/[channel]/deletion/route'
import { createDataDeletionStatusGetHandler } from '@/app/api/data-deletion/status/route'

describe('ANI-1142: Meta Data Deletion Callback Production Activation & Compliance Evidence', () => {
  const wranglerPath = path.resolve(__dirname, '../../wrangler.jsonc')
  const complianceDocPath = path.resolve(__dirname, '../../docs/11th/META_DATA_DELETION_COMPLIANCE_EVIDENCE.md')

  it('verifies wrangler.jsonc has META_DATA_DELETION_CALLBACK_ENABLED set to true', () => {
    expect(fs.existsSync(wranglerPath)).toBe(true)
    const content = fs.readFileSync(wranglerPath, 'utf-8')
    expect(content).toContain('"META_DATA_DELETION_CALLBACK_ENABLED": "true"')
  })

  it('verifies compliance documentation exists and documents all endpoints', () => {
    expect(fs.existsSync(complianceDocPath)).toBe(true)
    const doc = fs.readFileSync(complianceDocPath, 'utf-8')
    expect(doc).toContain('/api/channels/instagram/deletion')
    expect(doc).toContain('/api/channels/threads/deletion')
    expect(doc).toContain('/data-deletion/status')
    expect(doc).toContain('META_DATA_DELETION_CALLBACK_ENABLED')
  })

  function createSignedRequest(payload: Record<string, unknown>, secret: string): string {
    const rawPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const sig = createHmac('sha256', secret).update(rawPayload).digest('base64url')
    return `${sig}.${rawPayload}`
  }

  it('processes valid Meta signed request and returns confirmation code and status URL', async () => {
    const mockAppSecret = 'test_meta_app_secret_32_bytes_long!'
    const createdRequests: any[] = []

    const handler = createProviderDeletionPostHandler({
      enabled: true,
      appUrl: 'https://example.com',
      secretFor: () => mockAppSecret,
      verifySignedRequest: async (val, secret) => {
        expect(secret).toBe(mockAppSecret)
        return { externalAccountId: 'meta_user_999888' }
      },
      generateConfirmationCode: () => 'test_confirmation_code_abc123',
      createRequest: async (input) => {
        createdRequests.push(input)
        return { requestId: 'del_req_12345' }
      },
    })

    const formData = new FormData()
    formData.append('signed_request', 'valid.signed.request')

    const request = new Request('https://example.com/api/channels/instagram/deletion', {
      method: 'POST',
      body: formData,
    })

    const response = await handler(request, { params: Promise.resolve({ channel: 'instagram' }) })
    expect(response.status).toBe(200)

    const json = await response.json()
    expect(json.confirmation_code).toBe('test_confirmation_code_abc123')
    expect(json.url).toBe('https://example.com/data-deletion/status?code=test_confirmation_code_abc123')

    expect(createdRequests.length).toBe(1)
    expect(createdRequests[0]).toEqual({
      provider: 'instagram',
      externalAccountId: 'meta_user_999888',
      confirmationCode: 'test_confirmation_code_abc123',
    })
  })

  it('rejects invalid signature or tampered request with 400 Bad Request', async () => {
    const handler = createProviderDeletionPostHandler({
      enabled: true,
      appUrl: 'https://example.com',
      secretFor: () => 'valid_secret',
      verifySignedRequest: async () => {
        throw new Error('META_SIGNED_REQUEST_INVALID')
      },
      generateConfirmationCode: () => 'code',
      createRequest: async () => ({ requestId: 'id' }),
    })

    const formData = new FormData()
    formData.append('signed_request', 'invalid_signature_payload')

    const request = new Request('https://example.com/api/channels/instagram/deletion', {
      method: 'POST',
      body: formData,
    })

    const response = await handler(request, { params: Promise.resolve({ channel: 'instagram' }) })
    expect(response.status).toBe(400)
  })

  it('returns 503 when callback is disabled via flag', async () => {
    const handler = createProviderDeletionPostHandler({
      enabled: false, // Disabled
      appUrl: 'https://example.com',
      secretFor: () => 'secret',
      verifySignedRequest: async () => ({ externalAccountId: '123' }),
      generateConfirmationCode: () => 'code',
      createRequest: async () => ({ requestId: 'id' }),
    })

    const request = new Request('https://example.com/api/channels/instagram/deletion', {
      method: 'POST',
      body: new FormData(),
    })

    const response = await handler(request, { params: Promise.resolve({ channel: 'instagram' }) })
    expect(response.status).toBe(503)
  })

  it('queries data deletion status via GET handler', async () => {
    const handler = createDataDeletionStatusGetHandler({
      findStatus: async ({ confirmationCode }) => {
        if (confirmationCode === 'valid_code') {
          return {
            status: 'completed',
            origin: 'meta',
            scope: 'provider',
            provider: 'instagram',
            requestedAt: '2026-09-08T12:00:00.000Z',
            updatedAt: '2026-09-08T12:05:00.000Z',
            completedAt: '2026-09-08T12:05:00.000Z',
          }
        }
        return null
      },
    })

    // Found
    const validReq = new Request('https://example.com/api/data-deletion/status?code=valid_code')
    const validRes = await handler(validReq)
    expect(validRes.status).toBe(200)
    const json = await validRes.json()
    expect(json.status).toBe('completed')
    expect(json.confirmation_code).toBe('valid_code')

    // Not found
    const invalidReq = new Request('https://example.com/api/data-deletion/status?code=nonexistent')
    const invalidRes = await handler(invalidReq)
    expect(invalidRes.status).toBe(404)
  })
})
