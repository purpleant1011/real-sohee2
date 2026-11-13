import type { JobStatus } from '@/features/sohee-growth/types'

export interface JobStatusChipMeta {
  label: string
  variant: 'success' | 'warning' | 'info' | 'secondary' | 'purple'
}

export const JOB_STATUS_CHIP: Record<JobStatus, JobStatusChipMeta> = {
  available: { label: '가능', variant: 'success' },
  preview_only: { label: '미리보기만 가능', variant: 'warning' },
  learning: { label: '준비 중', variant: 'info' },
  locked: { label: '잠김', variant: 'secondary' },
  membership: { label: '정식회원 전용', variant: 'secondary' },
  coming_soon: { label: '곧 열려요', variant: 'purple' },
}
