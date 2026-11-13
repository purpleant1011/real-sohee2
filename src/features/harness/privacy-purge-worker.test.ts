import { describe, it, expect } from 'vitest'
import { privacyPurgeWorker, MediaArtifact } from './privacy-purge-worker'

describe('PrivacyPurgeWorker (ANI-259)', () => {
  it('purges 3rd-party benchmark media older than 24 hours while keeping user-owned media', () => {
    const artifacts: MediaArtifact[] = [
      {
        id: 'art_old_3rd_party',
        workspaceId: 'ws_1',
        sourceUrl: 'https://instagram.com/p/1',
        mediaType: 'IMAGE',
        capturedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
        storagePath: '/storage/temp/1.png',
        isUserOwned: false,
        privacyClass: 'PUBLIC_CLEAN'
      },
      {
        id: 'art_fresh_3rd_party',
        workspaceId: 'ws_1',
        sourceUrl: 'https://instagram.com/p/2',
        mediaType: 'IMAGE',
        capturedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
        storagePath: '/storage/temp/2.png',
        isUserOwned: false,
        privacyClass: 'PUBLIC_CLEAN'
      },
      {
        id: 'art_user_owned_old',
        workspaceId: 'ws_1',
        sourceUrl: 'https://myshop.com/photo.jpg',
        mediaType: 'IMAGE',
        capturedAt: new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString(),
        storagePath: '/storage/user/photo.jpg',
        isUserOwned: true,
        privacyClass: 'PUBLIC_CLEAN'
      }
    ]

    const res = privacyPurgeWorker.purgeExpiredArtifacts(artifacts)
    expect(res.purgedCount).toBe(1)
    expect(res.purgedArtifacts[0].id).toBe('art_old_3rd_party')
    expect(res.retainedArtifacts.length).toBe(2)
  })

  it('masks sensitive phone numbers and handles', () => {
    const raw = '예약 문의는 010-1234-5678 또는 @customer_kim 계정으로 DM 주세요.'
    const { sanitizedText, maskedCount } = privacyPurgeWorker.maskSensitiveInformation(raw)

    expect(maskedCount).toBe(2)
    expect(sanitizedText).toContain('010-****-5678')
    expect(sanitizedText).toContain('@***')
  })

  it('completely excludes third-party media when exporting harness bundle', () => {
    const bundle = privacyPurgeWorker.sanitizeExportBundle({
      harnessId: 'harness_1',
      userDesignOverrides: [{ ruleKey: 'tone', overrideValue: 'friendly' }],
      artifacts: [
        {
          id: 'art_3rd_party',
          workspaceId: 'ws_1',
          sourceUrl: 'https://instagram.com/p/1',
          mediaType: 'IMAGE',
          capturedAt: new Date().toISOString(),
          storagePath: '/storage/temp/1.png',
          isUserOwned: false,
          privacyClass: 'PUBLIC_CLEAN'
        },
        {
          id: 'art_user',
          workspaceId: 'ws_1',
          sourceUrl: 'https://user.com/logo.png',
          mediaType: 'IMAGE',
          capturedAt: new Date().toISOString(),
          storagePath: '/storage/user/logo.png',
          isUserOwned: true,
          privacyClass: 'PUBLIC_CLEAN'
        }
      ]
    })

    expect(bundle.excludedThirdPartyMediaCount).toBe(1)
    expect(bundle.exportPayload.userOwnedMedia.length).toBe(1)
    expect(bundle.exportPayload.userOwnedMedia[0].id).toBe('art_user')
  })
})
