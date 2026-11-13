import { ReportsEntry } from './reports-entry'

/**
 * 주간 CEO 보고. 모바일 R2(플래그 ON · 767px 이하 · allowlist)는 R2 주간 보고로,
 * 그 밖은 기존 V088 콘솔 그대로다(M20 / ANI-1706 잔여 B).
 */
export default function ReportsPage() {
  return <ReportsEntry />
}
