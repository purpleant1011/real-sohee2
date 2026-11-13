import type { VaultItem, VaultVariantPayload } from '../types'
import { formatChannelLabel } from '../query/formatters'
import { readVaultCopyContent } from './content'
import type {
  ManualPublishRecord,
  VaultBundleImage,
  VaultCopyBundle,
  VaultCopyBundlePublicationStatus,
} from './types'

export interface GenerateCopyBundleInput {
  item: VaultItem
  payload: VaultVariantPayload | null
  signedImages: VaultBundleImage[]
  manualPublish: ManualPublishRecord | null
  itemRef: string
}

const SETTINGS_NOTICES: Record<string, string> = {
  naver_blog:
    '카테고리 및 공개 설정(전체공개/이웃공개 등)은 네이버 블로그 스마트에디터에서 직접 선택해 주세요.',
  daangn_business:
    '쿠폰/이벤트 설정 및 노출 지역은 당근 비즈프로필에서 직접 선택해 주세요.',
  instagram:
    '위치 태그 및 상세 설정은 인스타그램 앱에서 직접 선택해 주세요.',
  threads:
    '답글 허용 범위 등은 스레드 앱에서 직접 선택해 주세요.',
}

const GUIDE_STEPS: Record<string, string[]> = {
  naver_blog: [
    "1. '제목'과 '본문' 또는 '한 번에 복사'를 눌러 내용을 복사하세요.",
    '2. 네이버 블로그 앱 또는 PC 스마트에디터를 열고 붙여넣으세요.',
    '3. 이미지 내려받기를 통해 사진을 본문에 첨부하세요.',
    '4. 카테고리와 공개 설정을 직접 선택한 후 글을 등록하세요.',
    '5. 등록 완료 후 생성된 글 주소(URL)를 아래에 입력해 보관을 마무리하세요.',
  ],
  daangn_business: [
    "1. '본문' 또는 '한 번에 복사'를 눌러 내용을 복사하세요.",
    "2. 당근 앱의 비즈프로필 관리 화면에서 '소식 쓰기'를 여세요.",
    '3. 본문 영역에 내용을 붙여넣고 사진을 첨부하세요.',
    '4. 이벤트나 쿠폰, 노출 범위를 직접 선택한 후 소식을 등록하세요.',
    '5. 등록 완료 후 소식 주소(URL)를 아래에 입력해 보관을 마무리하세요.',
  ],
  instagram: [
    "1. '본문' 또는 '한 번에 복사'를 눌러 복사하세요.",
    '2. 인스타그램 앱에서 새 게시물을 작성하세요.',
    '3. 내려받은 사진을 순서대로 선택하고 문구를 붙여넣으세요.',
    '4. 공유 완료 후 게시물 링크(URL)를 아래에 입력해 주세요.',
  ],
  threads: [
    "1. '본문'을 복사하세요.",
    '2. 스레드 앱에서 새 스레드를 작성하고 붙여넣으세요.',
    '3. 사진을 첨부하고 게시하세요.',
    '4. 게시 후 스레드 링크(URL)를 아래에 입력해 주세요.',
  ],
}

export function generateCopyBundle({
  item,
  payload,
  signedImages,
  manualPublish,
  itemRef,
}: GenerateCopyBundleInput): VaultCopyBundle {
  // Title, body and tags come from the same reader the preview uses (see content.ts).
  const { title, body, tags, formattedTags, fullText } = readVaultCopyContent(item.channel, payload?.payload)

  const publicationStatus: VaultCopyBundlePublicationStatus = manualPublish
    ? {
        statusLabel: '사장님이 직접 올린 글로 기록됐어요(확인 전)',
        isPublishedUrlRegistered: true,
        publishedUrl: manualPublish.publishedUrl,
        registeredAt: manualPublish.createdAt,
      }
    : {
        statusLabel: '발행 준비 완료 · 외부 게시 전',
        isPublishedUrlRegistered: false,
        publishedUrl: null,
        registeredAt: null,
      }

  return {
    itemRef,
    channel: item.channel,
    channelLabel: formatChannelLabel(item.channel),
    title,
    body,
    tags,
    formattedTags,
    fullText,
    settingsNotice:
      SETTINGS_NOTICES[item.channel] ??
      '상세 설정 및 카테고리는 게시 앱에서 직접 선택해 주세요.',
    images: signedImages,
    guideSteps: GUIDE_STEPS[item.channel] ?? [
      '1. 문구를 복사하고 이미지를 내려받으세요.',
      '2. 해당 앱에 붙여넣고 게시하세요.',
      '3. 게시 완료 후 URL을 입력해 주세요.',
    ],
    publicationStatus,
  }
}
