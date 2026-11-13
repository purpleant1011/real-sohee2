export interface ApplicationState { status?: string | null; hasDocument?: boolean }
/** 사업자 인증 '신청 완료' 여부: 승인됐거나, 서류와 함께 접수되어 승인 대기 중이면 true. */
export function isApplicationSubmitted(input: ApplicationState | null | undefined): boolean {
  if (!input) return false
  if (input.status === 'VERIFIED') return true
  return input.status === 'PENDING' && input.hasDocument === true
}
export interface AppEntryInput {
  applicationSubmitted: boolean
  prepared: boolean
  educationShell: boolean
  reviewAccount?: boolean
}
export function resolveAppEntryRedirect(input: AppEntryInput): '/start' | null {
  if (input.reviewAccount) return null
  if (!input.applicationSubmitted) return '/start'
  if (input.educationShell && !input.prepared) return '/start'
  return null
}


/** /app 입구 판정을 통과한(= 이미 시작을 마친) 사용자는 /start 마법사를 다시 보지 않고 /app 으로 간다. */
export function resolveStartPageRedirect(input: AppEntryInput): '/app' | null {
  return resolveAppEntryRedirect(input) === null ? '/app' : null
}
