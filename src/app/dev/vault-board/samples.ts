import { composeCopyText, formatCopyTags } from '@/features/vault/bundle/content'
import type { VaultCopyBundle } from '@/features/vault/bundle/types'
import type { VaultItemDetailDto } from '@/features/vault/query/types'
import type { VaultBoardData } from '@/features/vault/ui/board/vault-board'
import type { StaticVaultFixtures } from '@/features/vault/ui/board/static-vault-api'

// Static fixtures only: no authentication, remote assets, or API requests.
const day = { created_at: '2026-10-07', updated_at: '2026-10-07' }
const image = { type: 'image' as const, mime_type: 'image/jpeg', size_bytes: 482_000 }

const instagram: VaultItemDetailDto = {
  item_ref: 'sample-one', channel: 'instagram', channel_label: '인스타그램', status_label: '발행 준비 완료 · 외부 게시 전', hold_reason_label: '사용자 보류',
  target_date: '2026-10-08', held_at: '2026-10-07', ...day,
  content: { title: '가을 신메뉴 안내', body: '가을 맞이 밤 라떼가 나왔어요.\n따뜻할 때 한번 들러 주세요.', tags: ['카페', '가을신메뉴'] },
  media: [image], settings: { category: null, coupon: null }, needs_reapproval: false, is_user_held: true, is_deleted: false, deleted_at: null,
}
const naver: VaultItemDetailDto = {
  item_ref: 'sample-two', channel: 'naver_blog', channel_label: '네이버 블로그', status_label: '재확인 필요', hold_reason_label: '재승인 필요',
  target_date: null, held_at: '2026-10-07', ...day,
  content: { title: '가을 신메뉴 소개', body: '안녕하세요. 이번 주부터 가을 신메뉴를 선보여요.\n\n밤 라떼와 고구마 케이크를 가장 먼저 만나 보세요.', tags: ['카페', '신메뉴'] },
  media: [image], settings: { category: null, coupon: null }, needs_reapproval: true, is_user_held: false, is_deleted: false, deleted_at: null,
}
const daangn: VaultItemDetailDto = {
  item_ref: 'sample-three', channel: 'daangn_business', channel_label: '당근 비즈니스', status_label: '승인이 풀렸어요', hold_reason_label: null,
  target_date: '2026-10-12', held_at: '2026-10-07', ...day,
  content: { title: '이번 주 단골 혜택', body: '이번 주 방문하시면 음료 한 잔을 서비스로 드려요.\n영업시간은 오전 9시부터 오후 8시까지예요.', tags: [] },
  media: [], settings: { category: null, coupon: null }, needs_reapproval: true, is_user_held: false, is_deleted: false, deleted_at: null,
}

export const sampleDetails = { [instagram.item_ref]: instagram, [naver.item_ref]: naver, [daangn.item_ref]: daangn } as const

function bundleOf(detail: VaultItemDetailDto, settingsNotice: string, guideSteps: string[]): VaultCopyBundle {
  const fields = detail.content
  return {
    itemRef: detail.item_ref, channel: detail.channel, channelLabel: detail.channel_label, title: fields.title, body: fields.body, tags: fields.tags,
    formattedTags: formatCopyTags(fields.tags), fullText: composeCopyText(detail.channel, fields), settingsNotice,
    images: detail.media.map((_, index) => ({
      id: `sample-image-${index + 1}`, position: index, storageBucket: 'sample', objectPath: 'sample', format: 'jpeg', width: 1080, height: 1080, signedUrl: '', downloadFilename: `${detail.channel}_image_${index + 1}.jpg`,
    })),
    guideSteps, publicationStatus: { statusLabel: '발행 준비 완료 · 외부 게시 전', isPublishedUrlRegistered: false, publishedUrl: null, registeredAt: null },
  }
}

export const sampleFixtures: StaticVaultFixtures = {
  details: sampleDetails,
  bundles: {
    [naver.item_ref]: bundleOf(naver, '카테고리 및 공개 설정은 네이버 블로그 스마트에디터에서 직접 선택해 주세요.', [
      "1. '제목'과 '본문' 또는 '한 번에 복사'를 눌러 내용을 복사하세요.",
      '2. 네이버 블로그 앱 또는 PC 스마트에디터를 열고 붙여넣으세요.',
      '3. 카테고리와 공개 설정을 직접 선택한 후 글을 등록하세요.',
    ]),
    [daangn.item_ref]: bundleOf(daangn, '쿠폰과 노출 지역은 당근 비즈프로필에서 직접 선택해 주세요.', [
      "1. '본문' 또는 '한 번에 복사'를 눌러 내용을 복사하세요.",
      "2. 당근 앱의 비즈프로필 관리 화면에서 '소식 쓰기'를 여세요.",
    ]),
  },
}

export const samples: VaultBoardData = {
  items: { items: Object.values(sampleDetails).map(({ item_ref, channel, channel_label, status_label, hold_reason_label, target_date, held_at, created_at, updated_at }) => ({ item_ref, channel, channel_label, status_label, hold_reason_label, target_date, held_at, created_at, updated_at })), nextCursor: null, hasMore: false },
  calendar: { ym: '2026-10', days: { '2026-10-08': { total: 1, channels: { instagram: 1 } }, '2026-10-12': { total: 1, channels: { daangn_business: 1 } } }, unscheduled_count: 1 },
  summary: { stored_count: 1, needs_reapproval_count: 2, invalidated_count: 1, total_count: 3, external_action_count: 0, external_action_warning: null },
}
