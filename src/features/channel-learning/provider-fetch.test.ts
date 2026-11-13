import { describe, expect, it, vi } from 'vitest'
import {
  fetchLearningProvider,
  fetchMediaSafely,
  ProviderTransportError,
  type ProviderFetchDeps,
} from './provider-fetch'
import { LearningError } from './contracts'

describe('provider fetch & media safety', () => {
  describe('fetchLearningProvider', () => {
    it('calls official provider origin with path and bearer token', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ id: '12345', username: 'sohee_salon' })),
      })

      const deps: ProviderFetchDeps = {
        fetch: mockFetch,
        sleep: vi.fn(),
      }

      const result = await fetchLearningProvider(
        {
          provider: 'instagram',
          path: '/me',
          accessToken: 'secret_token_12345',
          maxBytes: 2 * 1024 * 1024,
        },
        deps,
      )

      expect(result).toEqual({ id: '12345', username: 'sohee_salon' })
      expect(mockFetch).toHaveBeenCalledWith(
        'https://graph.instagram.com/me',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer secret_token_12345',
          }),
        }),
      )
    })

    it('rejects path traversal or unapproved path', async () => {
      const deps: ProviderFetchDeps = {
        fetch: vi.fn(),
      }

      await expect(
        fetchLearningProvider(
          {
            provider: 'instagram',
            path: '/me/../../etc/passwd',
            accessToken: 'token',
            maxBytes: 1024,
          },
          deps,
        ),
      ).rejects.toThrow(LearningError)

      await expect(
        fetchLearningProvider(
          {
            provider: 'instagram',
            path: '/unknown/dangerous/endpoint',
            accessToken: 'token',
            maxBytes: 1024,
          },
          deps,
        ),
      ).rejects.toThrowError(/unauthorized_provider_path/i)
    })

    it('does not leak response body or raw secrets on provider HTTP errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 400,
        ok: false,
        headers: new Headers({ 'content-type': 'application/json' }),
        arrayBuffer: async () =>
          new TextEncoder().encode(
            JSON.stringify({
              error: {
                message: 'Sensitive internal stack and secret_token_12345',
                code: 190,
              },
            }),
          ),
      })

      const deps: ProviderFetchDeps = {
        fetch: mockFetch,
        sleep: vi.fn(),
      }

      try {
        await fetchLearningProvider(
          {
            provider: 'threads',
            path: '/me',
            accessToken: 'secret_token_12345',
            maxBytes: 1024,
          },
          deps,
        )
        expect.fail('should have thrown')
      } catch (err: any) {
        expect(err).toBeInstanceOf(LearningError)
        // Must contain safe code/status only, not raw body or secrets
        expect(err.message).toContain('HTTP 상태 코드: 400')
        expect(err.message).not.toContain('Sensitive internal stack')
        expect(err.message).not.toContain('secret_token_12345')
      }
    })

    it('rejects foreign redirect targets to prevent token leakage', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 302,
        ok: false,
        headers: new Headers({
          location: 'https://evil.attacker.com/steal-token',
        }),
      })

      const deps: ProviderFetchDeps = {
        fetch: mockFetch,
        sleep: vi.fn(),
      }

      await expect(
        fetchLearningProvider(
          {
            provider: 'instagram',
            path: '/me',
            accessToken: 'secret_token_12345',
            maxBytes: 1024,
          },
          deps,
        ),
      ).rejects.toThrowError(/foreign_redirect_prohibited/i)
    })

    it('rejects redirect URLs containing userinfo or unapproved path', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 302,
        ok: false,
        headers: new Headers({
          location: 'https://admin:pass@graph.instagram.com/me',
        }),
      })

      const deps: ProviderFetchDeps = {
        fetch: mockFetch,
        sleep: vi.fn(),
      }

      await expect(
        fetchLearningProvider(
          {
            provider: 'instagram',
            path: '/me',
            accessToken: 'secret_token_12345',
            maxBytes: 1024,
          },
          deps,
        ),
      ).rejects.toThrowError(/userinfo_not_allowed/i)
    })

    it('enforces maximum 3 hops on redirects', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 302,
        ok: false,
        headers: new Headers({
          location: 'https://graph.instagram.com/me',
        }),
      })

      const deps: ProviderFetchDeps = {
        fetch: mockFetch,
        sleep: vi.fn(),
      }

      await expect(
        fetchLearningProvider(
          {
            provider: 'instagram',
            path: '/me',
            accessToken: 'secret_token_12345',
            maxBytes: 1024,
          },
          deps,
        ),
      ).rejects.toThrowError(/too_many_redirects/i)
      expect(mockFetch).toHaveBeenCalledTimes(4) // initial + 3 redirects = 4 calls total
    })

    it('cancels stream immediately when stream exceeds maxBytes', async () => {
      let canceled = false
      const mockStream = {
        getReader: () => {
          let callCount = 0
          return {
            read: async () => {
              callCount++
              if (callCount > 3) return { done: true, value: undefined }
              // 1000 bytes per chunk
              return { done: false, value: new Uint8Array(1000) }
            },
            cancel: async () => {
              canceled = true
            },
          }
        },
      }

      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: mockStream,
      })

      const deps: ProviderFetchDeps = {
        fetch: mockFetch,
        sleep: vi.fn(),
      }

      await expect(
        fetchLearningProvider(
          {
            provider: 'instagram',
            path: '/me',
            accessToken: 'token',
            maxBytes: 1500, // 1500 limit: second chunk exceeds limit (2000 > 1500)
          },
          deps,
        ),
      ).rejects.toThrowError(/payload_too_large/i)

      expect(canceled).toBe(true)
    })

    it('throws ProviderTransportError with numeric status on HTTP errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        headers: new Headers({ 'content-type': 'application/json' }),
        arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ error: 'invalid_token' })),
      })

      const deps: ProviderFetchDeps = {
        fetch: mockFetch,
        sleep: vi.fn(),
      }

      let thrownErr: any = null
      try {
        await fetchLearningProvider(
          {
            provider: 'instagram',
            path: '/me',
            accessToken: 'token',
            maxBytes: 1024,
          },
          deps,
        )
      } catch (err) {
        thrownErr = err
      }

      expect(thrownErr).toBeInstanceOf(ProviderTransportError)
      expect(thrownErr.status).toBe(401)
      expect(thrownErr.code).toBe('PROVIDER_HTTP_ERROR')
    })
  })

  describe('fetchMediaSafely', () => {
    it('fetches media from approved CDN origins without OAuth header and verifies magic bytes', async () => {
      // Valid JPEG header: FF D8 FF E0 ... + padding to >= 12 bytes
      const sampleJpeg = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ])

      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers({
          'content-type': 'image/jpeg',
          'content-length': '12',
        }),
        arrayBuffer: async () => sampleJpeg.buffer,
      })

      const deps: ProviderFetchDeps = {
        fetch: mockFetch,
      }

      const result = await fetchMediaSafely(
        {
          url: 'https://scontent.cdninstagram.com/v/t51.2885-15/sample.jpg',
          maxBytes: 10 * 1024 * 1024,
        },
        deps,
      )

      expect(result.contentType).toBe('image/jpeg')
      expect(result.data).toHaveLength(12)

      // Ensure NO Authorization header was passed to CDN
      const callHeaders = mockFetch.mock.calls[0][1]?.headers
      expect(callHeaders?.Authorization).toBeUndefined()
    })

    it('rejects unsupported media MIME types (e.g. SVG, HTML, video)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers({
          'content-type': 'image/svg+xml',
        }),
      })

      const deps: ProviderFetchDeps = {
        fetch: mockFetch,
      }

      await expect(
        fetchMediaSafely(
          {
            url: 'https://scontent.cdninstagram.com/sample.svg',
            maxBytes: 1024,
          },
          deps,
        ),
      ).rejects.toThrowError(/unsupported_media_type/i)
    })

    it('rejects media when magic bytes do not match raster image signatures', async () => {
      // MIME claims image/jpeg, but body starts with HTML "<!DOCTYPE"
      const fakeJpeg = new TextEncoder().encode('<!DOCTYPE html><html><body>fake</body></html>')

      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers({
          'content-type': 'image/jpeg',
        }),
        arrayBuffer: async () => fakeJpeg.buffer,
      })

      const deps: ProviderFetchDeps = {
        fetch: mockFetch,
      }

      await expect(
        fetchMediaSafely(
          {
            url: 'https://scontent.cdninstagram.com/fake.jpg',
            maxBytes: 1024,
          },
          deps,
        ),
      ).rejects.toThrowError(/invalid_media_format/i)
    })

    it('rejects media URLs with userinfo or non-allowlisted domains', async () => {
      const deps: ProviderFetchDeps = {
        fetch: vi.fn(),
      }

      await expect(
        fetchMediaSafely(
          {
            url: 'https://admin:pass@scontent.cdninstagram.com/image.jpg',
            maxBytes: 1024,
          },
          deps,
        ),
      ).rejects.toThrowError(/userinfo_not_allowed/i)

      await expect(
        fetchMediaSafely(
          {
            url: 'https://attacker.evil.com/fake-image.jpg',
            maxBytes: 1024,
          },
          deps,
        ),
      ).rejects.toThrowError(/unauthorized_media_host/i)
    })
  })
})
