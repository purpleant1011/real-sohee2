import type { WorkspaceRole } from '@/features/auth/workspace-context'

/** 보관함 변경(승인·수정·삭제·게시 주소 등록)은 대표 또는 관리자만 할 수 있어요. 읽기는 모든 구성원이 가능해요. */
export const VAULT_WRITE_FORBIDDEN_MESSAGE = '이 작업은 매장 관리자만 할 수 있어요.'

export function canWriteVault(role: WorkspaceRole | string | null | undefined): boolean {
  return role === 'owner' || role === 'manager'
}
