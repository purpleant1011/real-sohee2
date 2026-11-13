import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChannelPreview } from '@/features/preview/channel-preview'
import { PREVIEW_ACCOUNT_LABEL, toPreviewInput } from '@/features/vault/ui/board/item-preview-input'
import { toVaultItemDetailDto } from '../../query/item-detail'
import type { VaultChannel, VaultItem, VaultJson, VaultVariantPayload } from '../../types'
import { generateCopyBundle } from '../generator'

/**
 * ANI-1541 acceptance: "the exported body equals the preview, character for character".
 *
 * One saved variant payload goes through both paths: the copy bundle generator (what the owner pastes) and the
 * detail DTO -> preview adapter input (what the owner approved). Every exported field is then located in the
 * rendered preview and compared with strict equality. A loose substring match would hide drift, so each
 * channel compares whole elements.
 */
const ITEM_ID = '22222222-2222-4222-8222-222222222222'
const WS = '11111111-1111-4111-8111-111111111111'
const DIGEST = 'a'.repeat(64)

const TITLE = '  가을 신메뉴 안내  '
const BODY = '안녕하세요! 가을 맞이 밤 라떼가 나왔어요.\n\n  따뜻할 때 드세요.\n마감은 10월 31일까지예요. #행사'
// Deliberately messy: the bundle and the preview must still agree after normalization.
const TAGS: VaultJson[] = ['#카페', '##가을신메뉴', ' 밤라떼 ', '#', '']

function variant(channel: VaultChannel): { item: VaultItem; payload: VaultVariantPayload } {
  const item: VaultItem = {
    id: ITEM_ID, workspaceId: WS, contentId: '33333333-3333-4333-8333-333333333333', versionId: '44444444-4444-4444-8444-444444444444', channel,
    releaseGate: 'HELD_USER', holdReason: 'USER_HELD', heldAt: '2026-10-08T09:00:00Z', heldBy: null, targetDate: '2026-10-15', approvedFingerprint: 'f'.repeat(64),
    fingerprintSchemaVersion: 3, policyVersion: 'vault-save-v1', specVersion: '2026.10.1', approvalState: 'APPROVED', approvedBy: null, bundleId: null,
    idempotencyKey: 'k', deletedAt: null, createdAt: '2026-10-08T09:00:00Z', updatedAt: '2026-10-08T09:00:00Z',
  }
  const payload: VaultVariantPayload = {
    id: '66666666-6666-4666-8666-666666666666', workspaceId: WS, vaultItemId: ITEM_ID, previewArtifacts: {}, createdAt: '', updatedAt: '',
    payload: {
      title: TITLE, text: BODY, hashtags: TAGS,
      media: [{ position: 0, type: 'image', mimeType: 'image/jpeg', sizeBytes: 1000, renditionContentDigest: DIGEST }],
      settings: {}, targetAccountId: 'unconnected:internal',
      textBlockRenderSpec: { channel, blocks: [{ type: 'body', text: BODY }], digest: DIGEST },
    },
  }
  return { item, payload }
}

function renderBoth(channel: VaultChannel) {
  const { item, payload } = variant(channel)
  const bundle = generateCopyBundle({ item, payload, signedImages: [], manualPublish: null, itemRef: 'opaque-ref' })
  const detail = toVaultItemDetailDto(item, payload)
  const { preview, spec } = toPreviewInput(detail)
  render(<ChannelPreview {...preview} specResult={spec} />)
  return { bundle, detail, frame: screen.getByRole('region', { name: /예상 화면$/ }) }
}

/** Element-level exact text match (getByText normalizes whitespace, which would hide differences). */
function byExactText(root: HTMLElement, tag: string, text: string): HTMLElement {
  const found = Array.from(root.querySelectorAll<HTMLElement>(tag)).filter((element) => element.textContent === text)
  expect(found, `${tag} with exact text ${JSON.stringify(text)}`).toHaveLength(1)
  return found[0]
}

afterEach(() => cleanup())

describe('복사 번들과 미리보기는 같은 원본에서 나온다 (ANI-1541)', () => {
  it.each(['instagram', 'threads', 'naver_blog', 'daangn_business'] as const)('%s: 상세 DTO의 제목·본문·태그가 번들과 정확히 같다', (channel) => {
    const { item, payload } = variant(channel)
    const bundle = generateCopyBundle({ item, payload, signedImages: [], manualPublish: null, itemRef: 'opaque-ref' })
    const detail = toVaultItemDetailDto(item, payload)
    expect(detail.content).toEqual({ title: bundle.title, body: bundle.body, tags: bundle.tags })
    expect(bundle.title).toBe('가을 신메뉴 안내')
    expect(bundle.body).toBe(BODY)
    expect(bundle.tags).toEqual(['카페', '가을신메뉴', '밤라떼'])
    expect(bundle.formattedTags).toBe('#카페 #가을신메뉴 #밤라떼')
  })

  it('인스타그램: 미리보기 캡션 영역은 [계정 이름 + 번들 본문 + 번들 태그]와 글자 단위로 같다', () => {
    const { bundle, frame } = renderBoth('instagram')
    byExactText(frame, 'span', PREVIEW_ACCOUNT_LABEL)
    byExactText(frame, 'span', bundle.formattedTags)
    byExactText(frame, 'div', `${PREVIEW_ACCOUNT_LABEL} ${bundle.body}\n\n${bundle.formattedTags}`)
    expect(bundle.fullText).toBe(`${bundle.body}\n\n${bundle.formattedTags}`)
    expect(bundle.fullText).toMatchInlineSnapshot(`
      "안녕하세요! 가을 맞이 밤 라떼가 나왔어요.

        따뜻할 때 드세요.
      마감은 10월 31일까지예요. #행사

      #카페 #가을신메뉴 #밤라떼"
    `)
  })

  it('스레드: 미리보기 본문과 태그 줄이 번들의 본문·태그와 글자 단위로 같다', () => {
    const { bundle, frame } = renderBoth('threads')
    byExactText(frame, 'p', bundle.body)
    byExactText(frame, 'span', bundle.formattedTags)
    expect(bundle.fullText).toBe(`${bundle.body}\n\n${bundle.formattedTags}`)
    expect(bundle.fullText).toMatchInlineSnapshot(`
      "안녕하세요! 가을 맞이 밤 라떼가 나왔어요.

        따뜻할 때 드세요.
      마감은 10월 31일까지예요. #행사

      #카페 #가을신메뉴 #밤라떼"
    `)
  })

  it('네이버 블로그: 미리보기 제목·본문·태그가 번들의 제목·본문·태그와 글자 단위로 같고, 전체 복사는 이 세 값으로만 만든다', () => {
    const { bundle, frame } = renderBoth('naver_blog')
    byExactText(frame, 'h2', bundle.title!)
    byExactText(frame, 'p', bundle.body)
    const tags = within(within(frame).getByLabelText('태그')).getAllByText(/^#/).map((tag) => tag.textContent)
    expect(tags.join(' ')).toBe(bundle.formattedTags)
    expect(bundle.fullText).toBe(`[제목]\n${bundle.title}\n\n[본문]\n${bundle.body}\n\n[태그]\n${bundle.formattedTags}`)
    expect(bundle.fullText).toMatchInlineSnapshot(`
      "[제목]
      가을 신메뉴 안내

      [본문]
      안녕하세요! 가을 맞이 밤 라떼가 나왔어요.

        따뜻할 때 드세요.
      마감은 10월 31일까지예요. #행사

      [태그]
      #카페 #가을신메뉴 #밤라떼"
    `)
  })

  it('당근 비즈니스: 미리보기의 강조 제목·문단·태그 줄이 번들의 줄과 같다 (미리보기는 빈 줄과 줄 앞뒤 공백만 접는다)', () => {
    const { bundle, frame } = renderBoth('daangn_business')
    const heading = within(frame).getByLabelText('강조 문구')
    expect(heading.textContent).toBe(bundle.title)
    const article = frame.querySelector('article')!
    const shown = Array.from(article.querySelectorAll<HTMLElement>('h3, p'))
      .filter((element) => !element.closest('header') && !element.closest('section'))
      .map((element) => element.textContent)
    const exported = bundle.fullText.split('\n').map((line) => line.trim()).filter(Boolean)
    expect(shown).toEqual(exported)
    expect(bundle.fullText).toMatchInlineSnapshot(`
      "가을 신메뉴 안내

      안녕하세요! 가을 맞이 밤 라떼가 나왔어요.

        따뜻할 때 드세요.
      마감은 10월 31일까지예요. #행사

      #카페 #가을신메뉴 #밤라떼"
    `)
  })

  it('내용을 고치면 미리보기와 번들이 함께 바뀐다 (한쪽만 옛 값을 쓰지 않는다)', () => {
    const { item, payload } = variant('threads')
    const edited: VaultVariantPayload = { ...payload, payload: { ...payload.payload, text: '고친 본문입니다', hashtags: ['새태그'] } }
    const bundle = generateCopyBundle({ item, payload: edited, signedImages: [], manualPublish: null, itemRef: 'opaque-ref' })
    const { preview, spec } = toPreviewInput(toVaultItemDetailDto(item, edited))
    render(<ChannelPreview {...preview} specResult={spec} />)
    const frame = screen.getByRole('region', { name: '스레드 예상 화면' })
    byExactText(frame, 'p', '고친 본문입니다')
    byExactText(frame, 'span', '#새태그')
    expect(bundle.fullText).toBe('고친 본문입니다\n\n#새태그')
  })
})
