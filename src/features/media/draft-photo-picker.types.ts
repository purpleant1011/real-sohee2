/** 사진으로 글 만들기 시트용 사진 선택기(프레젠테이션 전용)의 계약. 로직은 MediaUploadCard가 갖고, 이 타입으로만 소통한다. */
export type DraftPhotoPeople = 'unknown' | 'none' | 'consented'

export interface DraftPhotoItem {
  id: string
  /** 사용 권리 확인 완료 + 공개 가능 → 선택 가능 */
  eligible: boolean
  /** 원본 보기 URL */
  src: string
}

export interface DraftPhotoPickerProps {
  workspaceId: string
  items: DraftPhotoItem[]
  selectedId: string | null
  /** 업로드·선택 등 진행 중이면 문구(없으면 null). 진행 중엔 모든 조작 비활성 */
  phase: string | null
  isUploading: boolean
  error: string | null
  notice: string | null
  /** 아직 저장 전인 선택 파일 (없으면 null) */
  file: File | null
  copyright: boolean
  people: DraftPhotoPeople
  consent: string
  confirmWithdrawalId: string | null
  onPickFile: (file: File | null) => void
  onCopyrightChange: (checked: boolean) => void
  onPeopleChange: (value: DraftPhotoPeople) => void
  onConsentChange: (value: string) => void
  onUpload: () => void
  onCancelTransfer: () => void
  onReload: () => void
  onSelect: (id: string) => void
  onAskWithdraw: (id: string | null) => void
  onWithdraw: (id: string) => void
}
