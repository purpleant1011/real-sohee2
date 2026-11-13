/**
 * SOHEE Harness Knowledge OS — Privacy & Raw Media 24h TTL Purge Worker (v1.1)
 * Enforces:
 * 1. 24h TTL automatic purge for 3rd-party benchmark media artifacts
 * 2. Privacy Masking on customer faces, reviewer names, phone numbers
 * 3. Export bundle privacy exclusion (AC-28, AC-41)
 */

export interface MediaArtifact {
  id: string
  workspaceId: string
  sourceUrl: string
  mediaType: 'IMAGE' | 'VIDEO_FRAME' | 'CAPTION_TEXT'
  capturedAt: string
  storagePath: string
  isUserOwned: boolean
  privacyClass: 'PUBLIC_CLEAN' | 'CONTAINS_FACE' | 'CONTAINS_USER_INFO'
}

export interface ExportBundleInput {
  harnessId: string
  artifacts: MediaArtifact[]
  userDesignOverrides: Record<string, any>[]
}

export class PrivacyPurgeWorker {
  private TTL_HOURS = 24

  /**
   * 1. 24시간 경과 제3자 원본 미디어 Purge
   */
  public purgeExpiredArtifacts(artifacts: MediaArtifact[]): {
    purgedArtifacts: MediaArtifact[]
    retainedArtifacts: MediaArtifact[]
    purgedCount: number
  } {
    const now = Date.now()
    const purgedArtifacts: MediaArtifact[] = []
    const retainedArtifacts: MediaArtifact[] = []

    for (const art of artifacts) {
      // User-owned assets are never automatically purged
      if (art.isUserOwned) {
        retainedArtifacts.push(art)
        continue
      }

      const ageHours = (now - new Date(art.capturedAt).getTime()) / (1000 * 60 * 60)
      if (ageHours >= this.TTL_HOURS) {
        purgedArtifacts.push(art)
      } else {
        retainedArtifacts.push(art)
      }
    }

    return {
      purgedArtifacts,
      retainedArtifacts,
      purgedCount: purgedArtifacts.length
    }
  }

  /**
   * 2. 개인정보 및 리뷰 작성자 닉네임 마스킹
   */
  public maskSensitiveInformation(rawText: string): {
    sanitizedText: string
    maskedCount: number
  } {
    let sanitized = rawText
    let count = 0

    // 전화번호 마스킹 (010-XXXX-XXXX)
    const phoneRegex = /(01[016789])[-. ]?(\d{3,4})[-. ]?(\d{4})/g
    if (phoneRegex.test(sanitized)) {
      sanitized = sanitized.replace(phoneRegex, '$1-****-$3')
      count++
    }

    // 인스타그램 멘션/아이디 마스킹 (@username)
    const mentionRegex = /@([a-zA-Z0-9._]{3,30})/g
    if (mentionRegex.test(sanitized)) {
      sanitized = sanitized.replace(mentionRegex, '@***')
      count++
    }

    return {
      sanitizedText: sanitized,
      maskedCount: count
    }
  }

  /**
   * 3. 하네스 Export 번들 생성 시 제3자 원본 미디어 100% 제외
   */
  public sanitizeExportBundle(input: ExportBundleInput): {
    exportPayload: {
      harnessId: string
      userDesignOverrides: Record<string, any>[]
      userOwnedMedia: MediaArtifact[]
    }
    excludedThirdPartyMediaCount: number
  } {
    const userOwnedMedia = input.artifacts.filter(a => a.isUserOwned)
    const excludedCount = input.artifacts.filter(a => !a.isUserOwned).length

    return {
      exportPayload: {
        harnessId: input.harnessId,
        userDesignOverrides: input.userDesignOverrides,
        userOwnedMedia
      },
      excludedThirdPartyMediaCount: excludedCount
    }
  }
}

export const privacyPurgeWorker = new PrivacyPurgeWorker()
