// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveFirstPostUserMedia } from './first-post-user-media'
import { FirstValueSourceError } from '@/features/media/first-value-source'

const valid = {
  id: '33333333-3333-4333-8333-333333333333',
  workspace_id: 'w1',
  provenance_kind: 'USER_UPLOAD',
  lifecycle_status: 'READY',
  rights_status: 'confirmed',
  publish_eligibility: true,
  generation_metadata: {
    uploadRights: {
      copyright: 'owned',
      commercialUse: true,
      identifiablePeople: 'none',
      consentReference: null,
    },
  },
}

function admin(rows: any[], queryError: any = null) {
  return {
    from: () => {
      const query: any = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({
          data: queryError ? null : (rows[0] ?? null),
          error: queryError,
        }),
        then: (resolve: any) => resolve({
          data: queryError ? null : rows,
          error: queryError,
        }),
      }
      return query
    },
  }
}

describe('resolveFirstPostUserMedia', () => {
  it('1. explicit 유효 — explicitAssetId 가 유효하면 해당 사진과 preview URL 및 도출된 권리를 반환한다', async () => {
    const result = await resolveFirstPostUserMedia({
      admin: admin([valid]),
      workspaceId: 'w1',
      explicitAssetId: valid.id,
    })

    expect(result).toEqual({
      selectedImageIds: [valid.id],
      mediaPreviews: [
        {
          id: valid.id,
          url: `/api/workspaces/w1/media/${valid.id}`,
        },
      ],
      rights: {
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
      },
    })
  })

  it('1-b. licensed 및 consented 피사체 권리가 유효하면 해당 권리를 반환한다', async () => {
    const licensedAsset = {
      ...valid,
      id: '55555555-5555-4555-8555-555555555555',
      generation_metadata: {
        uploadRights: {
          copyright: 'licensed',
          commercialUse: true,
          identifiablePeople: 'consented',
          consentReference: 'ref-doc-123',
        },
      },
    }

    const result = await resolveFirstPostUserMedia({
      admin: admin([licensedAsset]),
      workspaceId: 'w1',
      explicitAssetId: licensedAsset.id,
    })

    expect(result.rights).toEqual({
      rightsStatus: 'LICENSED',
      consentStatus: 'CONFIRMED',
    })
  })

  it('2. 선택값 — explicitAssetId 가 없고 selectedAssetId 가 주어지면 해당 사진을 선택한다', async () => {
    const result = await resolveFirstPostUserMedia({
      admin: admin([valid]),
      workspaceId: 'w1',
      selectedAssetId: valid.id,
    })

    expect(result).toEqual({
      selectedImageIds: [valid.id],
      mediaPreviews: [
        {
          id: valid.id,
          url: `/api/workspaces/w1/media/${valid.id}`,
        },
      ],
      rights: {
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
      },
    })
  })

  it('2-b. 우선순위 — explicitAssetId 와 selectedAssetId 가 모두 주어지면 explicitAssetId 가 우선한다', async () => {
    const otherValid = {
      ...valid,
      id: '44444444-4444-4444-8444-444444444444',
    }
    const result = await resolveFirstPostUserMedia({
      admin: admin([valid]),
      workspaceId: 'w1',
      explicitAssetId: valid.id,
      selectedAssetId: otherValid.id,
    })

    expect(result.selectedImageIds).toEqual([valid.id])
    expect(result.mediaPreviews[0].id).toBe(valid.id)
  })

  it('3. 권리 unknown — 저작권 또는 사용 권리가 미확인이면 FirstValueSourceError 로 거부한다', async () => {
    const unknownRights = {
      ...valid,
      rights_status: 'pending',
      publish_eligibility: false,
      generation_metadata: {
        uploadRights: {
          copyright: 'unknown',
          commercialUse: false,
          identifiablePeople: 'unknown',
          consentReference: null,
        },
      },
    }

    await expect(
      resolveFirstPostUserMedia({
        admin: admin([unknownRights]),
        workspaceId: 'w1',
        explicitAssetId: valid.id,
      }),
    ).rejects.toThrow(FirstValueSourceError)

    await expect(
      resolveFirstPostUserMedia({
        admin: admin([unknownRights]),
        workspaceId: 'w1',
        explicitAssetId: valid.id,
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_SELECTION_INVALID',
      status: 409,
    })
  })

  it('4. 타 tenant — 다른 workspace 의 사진이면 FirstValueSourceError 로 거부한다', async () => {
    const foreignTenant = {
      ...valid,
      workspace_id: 'w2',
    }

    await expect(
      resolveFirstPostUserMedia({
        admin: admin([foreignTenant]),
        workspaceId: 'w1',
        explicitAssetId: valid.id,
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_SELECTION_INVALID',
      status: 409,
    })
  })

  it('5. 철회 — 사용 권리가 철회된 사진이면 FirstValueSourceError 로 거부한다', async () => {
    const withdrawnRights = {
      ...valid,
      generation_metadata: {
        ...valid.generation_metadata,
        rightsWithdrawnAt: '2026-10-21T00:00:00Z',
      },
    }

    await expect(
      resolveFirstPostUserMedia({
        admin: admin([withdrawnRights]),
        workspaceId: 'w1',
        explicitAssetId: valid.id,
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_SELECTION_INVALID',
      status: 409,
    })
  })

  it('6. DB 오류 — 데이터베이스 조회 실패 시 FirstValueSourceError (MEDIA_FETCH_FAILED 503)를 그대로 전파한다', async () => {
    await expect(
      resolveFirstPostUserMedia({
        admin: admin([], { message: 'DB connection reset' }),
        workspaceId: 'w1',
        explicitAssetId: valid.id,
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_FETCH_FAILED',
      status: 503,
    })
  })

  it('7. 다중 선택 필요 — 선택값 없이 사진이 2장 이상이면 MEDIA_SELECTION_REQUIRED 로 거부한다', async () => {
    const secondPhoto = {
      ...valid,
      id: '55555555-5555-4555-8555-555555555555',
    }

    await expect(
      resolveFirstPostUserMedia({
        admin: admin([valid, secondPhoto]),
        workspaceId: 'w1',
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_SELECTION_REQUIRED',
      status: 409,
    })
  })

  it('8-a. none 빈결과 — explicitAssetId 가 none 이면 빈 배열을 반환하며 예시 사진으로 대체하지 않는다', async () => {
    const result = await resolveFirstPostUserMedia({
      admin: admin([valid]),
      workspaceId: 'w1',
      explicitAssetId: 'none',
    })

    expect(result).toEqual({
      selectedImageIds: [],
      mediaPreviews: [],
      rights: null,
    })
  })

  it('8-b. none 빈결과 — selectedAssetId 가 none 이면 빈 배열을 반환한다', async () => {
    const result = await resolveFirstPostUserMedia({
      admin: admin([valid]),
      workspaceId: 'w1',
      selectedAssetId: 'none',
    })

    expect(result).toEqual({
      selectedImageIds: [],
      mediaPreviews: [],
      rights: null,
    })
  })

  it('8-c. none 빈결과 — 선택값 없이 업로드된 사진이 0장이면 빈 배열을 반환한다', async () => {
    const result = await resolveFirstPostUserMedia({
      admin: admin([]),
      workspaceId: 'w1',
    })

    expect(result).toEqual({
      selectedImageIds: [],
      mediaPreviews: [],
      rights: null,
    })
  })

  it('URL 인코딩 — workspaceId 및 assetId 의 encodeURIComponent 처리를 보증한다', async () => {
    const specialWs = 'space/with special+chars'
    const validSpecialWs = {
      ...valid,
      workspace_id: specialWs,
    }
    const result = await resolveFirstPostUserMedia({
      admin: admin([validSpecialWs]),
      workspaceId: specialWs,
      explicitAssetId: valid.id,
    })

    expect(result.mediaPreviews[0].url).toBe(
      `/api/workspaces/${encodeURIComponent(specialWs)}/media/${encodeURIComponent(valid.id)}`,
    )
  })
})
