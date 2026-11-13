import { describe, expect, it } from 'vitest'
import { draftApprovalInput, draftAsset, draftAssetIssue, draftDatasetMode, draftSeedChannels, type DraftDto } from './draft-mapper'
import { approvalBlockers } from './approval-review'
import { canRenderPreview } from './preview-set'

const ORIGIN = 'https://app.example.com'
const MEDIA = '/api/workspaces/w1/media/img1'

const base: DraftDto = {
  datasetMode: 'ACTUAL',
  workspaceId: 'w1',
  copies: { instagram: { caption: '신메뉴' }, threads: { content: '짧은 글' } },
  selectedImageIds: ['img1'],
  mediaPreviews: [{ id: 'img1', url: MEDIA }],
  rights: { rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
  channels: [{ provider: 'instagram', handle: '@shop' }],
  approvalFingerprint: 'fp',
}

describe('draft mapper — 서버가 주지 않은 값은 만들지 않는다', () => {
  it('현재 초안(확장 필드 없음)은 미리보기·승인이 모두 fail-closed 다', () => {
    expect(canRenderPreview(draftAsset(base, ORIGIN))).toBe(false)
    const blockers = approvalBlockers(draftApprovalInput(base, true))
    expect(blockers).toEqual(expect.arrayContaining(['NO_CTA', 'CHANNEL_NOT_PUBLISHABLE', 'COST_UNKNOWN', 'EXECUTION_UNKNOWN']))
  })

  it('확장 필드가 모두 오면 승인 가능하다', () => {
    const full: DraftDto = {
      ...base,
      copies: { instagram: { caption: '신메뉴', cta: '예약하기' } },
      mediaPreviews: [{ id: 'img1', url: MEDIA, width: 800, height: 1000 }],
      channels: [{ provider: 'instagram', handle: '@shop', connection: 'CONNECTED', publishPermission: 'GRANTED' }],
      costQuote: { amountKrw: 0, source: 'SERVER_QUOTE' },
      executionSurface: 'MOBILE_OK',
    }
    expect(canRenderPreview(draftAsset(full, ORIGIN))).toBe(true)
    expect(approvalBlockers(draftApprovalInput(full, true))).toEqual([])
    expect(draftSeedChannels(full)[0].copy.cta).toBe('예약하기')
  })

  it('권리·지문이 없으면 확인으로 만들지 않는다', () => {
    const d = { ...base, rights: undefined, approvalFingerprint: ' ' }
    expect(draftAsset(d, ORIGIN)?.rights).toBe('UNCONFIRMED')
    expect(draftApprovalInput(d, true).serverFingerprint).toBeNull()
  })

  it('선택 사진과 맞는 미리보기가 없으면 asset 이 없다', () => {
    expect(draftAsset({ ...base, mediaPreviews: [{ id: 'other', url: MEDIA }] }, ORIGIN)).toBeNull()
  })
})

describe('draftAsset — 실제 데이터는 워크스페이스 자산만', () => {
  it('상대 경로에는 출처를 붙인다', () => {
    expect(draftAsset(base, ORIGIN)?.imageUrl).toBe(`${ORIGIN}${MEDIA}`)
  })
  it('다른 워크스페이스 media 경로는 미리보기를 만들지 않는다', () => {
    expect(draftAsset({ ...base, mediaPreviews: [{ id: 'img1', url: '/api/workspaces/w2/media/img1' }] }, ORIGIN)).toBeNull()
  })
  it('바깥 출처 사진 주소는 미리보기를 만들지 않는다', () => {
    expect(draftAsset({ ...base, mediaPreviews: [{ id: 'img1', url: 'https://cdn.example.com/a.jpg' }] }, ORIGIN)).toBeNull()
    expect(draftAsset({ ...base, mediaPreviews: [{ id: 'img1', url: '//evil.test/x' }] }, ORIGIN)).toBeNull()
  })
  it('워크스페이스 id 가 없으면 실제 데이터 경로도 받지 않는다', () => {
    expect(draftAsset({ ...base, workspaceId: undefined }, ORIGIN)).toBeNull()
  })
  it('선택한 사진 id 와 주소의 자산 id 가 다르면 미리보기를 만들지 않는다', () => {
    // 화면에 그린 사진과 승인·게시가 묶는 사진이 어긋나면 안 된다.
    const mismatch = { ...base, mediaPreviews: [{ id: 'img1', url: '/api/workspaces/w1/media/other', width: 800, height: 1000 }] }
    expect(draftAsset(mismatch, ORIGIN)).toBeNull()
    expect(draftAssetIssue(mismatch, ORIGIN)).toBe('MISSING_ASSET_ID')
  })
})

describe('draftAssetIssue — 빈 상태 사유를 구분한다', () => {
  it('사진을 고르지 않았으면 NO_ASSET', () => {
    expect(draftAssetIssue({ ...base, selectedImageIds: [] }, ORIGIN)).toBe('NO_ASSET')
  })
  it('골랐는데 확인하지 못했으면 MISSING_ASSET_ID', () => {
    expect(draftAssetIssue({ ...base, workspaceId: undefined }, ORIGIN)).toBe('MISSING_ASSET_ID')
    expect(draftAssetIssue({ ...base, mediaPreviews: [{ id: 'img1', url: '/api/workspaces/w2/media/img1' }] }, ORIGIN)).toBe('MISSING_ASSET_ID')
  })
  it('주소 형식이 잘못되면 INVALID_IMAGE_URL', () => {
    expect(draftAssetIssue({ ...base, mediaPreviews: [{ id: 'img1', url: 'javascript:alert(1)' }] }, ORIGIN)).toBe('INVALID_IMAGE_URL')
  })
  it('그릴 수 있으면 null', () => {
    expect(draftAssetIssue(base, ORIGIN)).toBeNull()
  })
})

describe('draftDatasetMode — strict 검증 (누락·무효는 null, 명시적 ACTUAL/SHOWCASE_DEMO/TEST 만 허용)', () => {
  it('서버가 datasetMode 필드를 누락(undefined)하면 ACTUAL 로 승격하지 않고 null(모름)이다', () => {
    const rawWithoutMode: DraftDto = { ...base, datasetMode: undefined }
    expect(draftDatasetMode(rawWithoutMode)).toBeNull()
    // mode 가 null 이면 자산도 해석하지 않고 fail-closed 차단된다
    expect(draftAsset(rawWithoutMode, ORIGIN)).toBeNull()
    expect(draftAssetIssue(rawWithoutMode, ORIGIN)).toBe('MISSING_ASSET_ID')
  })

  it('datasetMode 가 null 이거나 빈 문자열이면 null 이다', () => {
    expect(draftDatasetMode({ ...base, datasetMode: null })).toBeNull()
    expect(draftDatasetMode({ ...base, datasetMode: '' })).toBeNull()
  })

  it('모르는 값(UNKNOWN, CANARY, DEMO 등)은 실제 데이터로 승격하지 않고 null 이다', () => {
    expect(draftDatasetMode({ ...base, datasetMode: 'UNKNOWN' })).toBeNull()
    expect(draftDatasetMode({ ...base, datasetMode: 'CANARY' })).toBeNull()
    expect(draftDatasetMode({ ...base, datasetMode: 'DEMO' })).toBeNull()
    expect(draftAsset({ ...base, datasetMode: 'DEMO' }, ORIGIN)).toBeNull()
  })

  it('명시적으로 ACTUAL 인 경우에만 ACTUAL 로 판정되고 자산이 유효하다', () => {
    expect(draftDatasetMode({ ...base, datasetMode: 'ACTUAL' })).toBe('ACTUAL')
    expect(draftAsset({ ...base, datasetMode: 'ACTUAL' }, ORIGIN)).not.toBeNull()
  })

  it('명시적으로 SHOWCASE_DEMO, TEST 인 경우 해당 모드를 그대로 반환한다', () => {
    expect(draftDatasetMode({ ...base, datasetMode: 'SHOWCASE_DEMO' })).toBe('SHOWCASE_DEMO')
    expect(draftDatasetMode({ ...base, datasetMode: 'TEST' })).toBe('TEST')
  })

  it('예시 화면(SHOWCASE_DEMO)은 실제 사진 대신 인라인 자리표시자를 쓸 수 있다', () => {
    const demo = { ...base, datasetMode: 'SHOWCASE_DEMO', mediaPreviews: [{ id: 'img1', url: 'data:image/svg+xml;utf8,<svg/>', width: 10, height: 10 }] }
    expect(draftAsset(demo, ORIGIN)).not.toBeNull()
  })
})
