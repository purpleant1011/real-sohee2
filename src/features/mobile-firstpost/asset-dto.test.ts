import { describe, expect, it } from 'vitest'
import { assetScopeVerdict, toPreviewAsset } from './asset-dto'
import { DEMO_PLACEHOLDER_IMAGE } from './demo-placeholder'
import { canRenderPreview } from './preview-set'

const scope = { workspaceId: 'w1', assetId: 'a1', origin: 'https://app.example.com' }
const dto = {
  assetId: 'a1',
  url: 'https://app.example.com/api/workspaces/w1/media/a1',
  width: 800,
  height: 600,
  rightsStatus: 'CONFIRMED',
}

describe('toPreviewAsset', () => {
  it('완전한 DTO 는 미리보기를 만들 수 있다', () => {
    expect(canRenderPreview(toPreviewAsset(dto, null, scope))).toBe(true)
  })
  it('id·주소·크기가 없거나 잘못되면 null', () => {
    expect(toPreviewAsset(null, null, scope)).toBeNull()
    expect(toPreviewAsset({ ...dto, assetId: ' ' }, null, scope)).toBeNull()
    expect(toPreviewAsset({ ...dto, url: undefined }, null, scope)).toBeNull()
    expect(toPreviewAsset({ ...dto, width: 0 }, null, scope)).toBeNull()
    expect(toPreviewAsset({ ...dto, height: '600' }, null, scope)).toBeNull()
  })
  it('권리 상태가 CONFIRMED 가 아니면 미확인이다', () => {
    expect(toPreviewAsset({ ...dto, rightsStatus: 'PENDING' }, null, scope)?.rights).toBe('UNCONFIRMED')
    expect(canRenderPreview(toPreviewAsset({ ...dto, rightsStatus: undefined }, null, scope))).toBe(false)
  })
  it('서버 값이 없을 때만 게시 가능한 권리 선언이 확인으로 인정된다', () => {
    const d = { ...dto, rightsStatus: undefined }
    expect(toPreviewAsset(d, { ownership: 'OWN', hasPerson: false }, scope)?.rights).toBe('CONFIRMED')
    expect(toPreviewAsset(d, { ownership: 'OWN', hasPerson: true }, scope)?.rights).toBe('UNCONFIRMED')
    expect(toPreviewAsset({ ...dto, rightsStatus: 'REJECTED' }, { ownership: 'OWN', hasPerson: false }, scope)?.rights).toBe('UNCONFIRMED')
  })
  it('http 가 아닌 주소는 미리보기가 막힌다', () => {
    expect(canRenderPreview(toPreviewAsset({ ...dto, url: 'javascript:alert(1)' }, null, scope))).toBe(false)
  })
  it('주소가 다른 자산을 가리키면 미리보기를 만들지 않는다', () => {
    expect(toPreviewAsset({ ...dto, url: 'https://app.example.com/api/workspaces/w1/media/a2' }, null, scope)).toBeNull()
  })
  it('DTO 의 id 가 호출자가 기대한 자산과 다르면 미리보기를 만들지 않는다', () => {
    // id 와 주소가 함께 a2 를 가리켜도, 선택한 사진이 a1 이면 다른 사진이다.
    const other = { ...dto, assetId: 'a2', url: 'https://app.example.com/api/workspaces/w1/media/a2' }
    expect(toPreviewAsset(other, null, scope)).toBeNull()
    expect(toPreviewAsset(other, null, { ...scope, assetId: 'a2' })).not.toBeNull()
  })
  it('모르는 데이터셋 모드는 추측하지 않고 null', () => {
    expect(toPreviewAsset({ ...dto, datasetMode: 'DEMO' }, null, scope)).toBeNull()
    expect(toPreviewAsset({ ...dto, datasetMode: 'SHOWCASE_DEMO' }, null, scope)).not.toBeNull()
  })
})

describe('assetScopeVerdict — 실제 데이터는 워크스페이스 자산만', () => {
  it('같은 워크스페이스 media 경로는 통과한다', () => {
    expect(assetScopeVerdict('/api/workspaces/w1/media/a1', scope)).toBe('OK')
    expect(assetScopeVerdict('https://app.example.com/api/workspaces/w1/media/a1', scope)).toBe('OK')
  })
  it('다른 워크스페이스 경로는 거절한다', () => {
    expect(assetScopeVerdict('/api/workspaces/w2/media/a1', scope)).toBe('CROSS_WORKSPACE')
    expect(assetScopeVerdict('https://app.example.com/api/workspaces/w2/media/a1', scope)).toBe('CROSS_WORKSPACE')
  })
  it('바깥 출처·프로토콜 상대 주소는 거절한다', () => {
    expect(assetScopeVerdict('https://cdn.example.com/a.jpg', scope)).toBe('EXTERNAL_ORIGIN')
    expect(assetScopeVerdict('//evil.test/a.jpg', scope)).toBe('EXTERNAL_ORIGIN')
    expect(assetScopeVerdict('https://app.example.com/sohee_insta_post.jpg', scope)).toBe('NOT_WORKSPACE_SCOPED')
  })
  it('워크스페이스 id 를 모르면 실제 데이터 경로도 통과시키지 않는다', () => {
    expect(assetScopeVerdict('/api/workspaces/w1/media/a1', { assetId: 'a1', origin: 'https://app.example.com' })).toBe('NO_WORKSPACE')
  })
  it('경로의 자산 id 가 선택한 사진과 다르면 거절한다', () => {
    expect(assetScopeVerdict('/api/workspaces/w1/media/a2', scope)).toBe('ASSET_MISMATCH')
    expect(assetScopeVerdict('https://app.example.com/api/workspaces/w1/media/a2', scope)).toBe('ASSET_MISMATCH')
  })
  it('자산 id 를 모르면 실제 데이터 경로를 통과시키지 않는다', () => {
    expect(assetScopeVerdict('/api/workspaces/w1/media/a1', { workspaceId: 'w1', origin: 'https://app.example.com' })).toBe('NO_ASSET_ID')
  })
  it('실제 데이터에서 인라인 자리표시자는 거절한다', () => {
    expect(assetScopeVerdict(DEMO_PLACEHOLDER_IMAGE, scope)).toBe('INVALID_URL')
  })
  it('예시·시험 화면은 같은 출처 상대 경로와 인라인 자리표시자를 허용한다', () => {
    const demoScope = { ...scope, datasetMode: 'SHOWCASE_DEMO' as const }
    expect(assetScopeVerdict(DEMO_PLACEHOLDER_IMAGE, demoScope)).toBe('OK')
    expect(assetScopeVerdict('/sample.svg', demoScope)).toBe('OK')
    expect(assetScopeVerdict('https://cdn.example.com/a.jpg', demoScope)).toBe('EXTERNAL_ORIGIN')
  })
})
