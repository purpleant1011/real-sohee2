import { diagnosisInputSchema, type DiagnosisInput } from './diagnosis-schema'

export const DIAGNOSIS_INTENT_KEY = 'sohee-v085-diagnosis-intent'
export function saveDiagnosisIntent(input: DiagnosisInput) { sessionStorage.setItem(DIAGNOSIS_INTENT_KEY, JSON.stringify(diagnosisInputSchema.parse(input))) }
export function loadDiagnosisIntent(): DiagnosisInput | null { const raw = sessionStorage.getItem(DIAGNOSIS_INTENT_KEY); if (!raw) return null; try { return diagnosisInputSchema.parse(JSON.parse(raw)) } catch { sessionStorage.removeItem(DIAGNOSIS_INTENT_KEY); return null } }
export function clearDiagnosisIntent() { sessionStorage.removeItem(DIAGNOSIS_INTENT_KEY) }

const industryLabel = { beauty: '미용', food: '외식', education: '교육', 'local-service': '생활 서비스' } as const
const problemLabel = { inquiry: '고객 문의', booking: '예약', content: '콘텐츠', 'repeat-visit': '재방문' } as const
const channelLabel = { instagram: '인스타그램', threads: '스레드', 'naver-blog': '네이버 블로그', 'naver-place': '네이버 플레이스', 'daangn-business': '당근 비즈프로필' } as const

export function buildDiagnosisOnboardingDraft(input: DiagnosisInput) {
  return `${input.businessName} 매장은 ${industryLabel[input.industry]} 업종이고, 지금 가장 먼저 해결하고 싶은 문제는 ${problemLabel[input.problem]}입니다. 현재 확인하고 싶은 공개 채널은 ${channelLabel[input.channel]}입니다.`
}
