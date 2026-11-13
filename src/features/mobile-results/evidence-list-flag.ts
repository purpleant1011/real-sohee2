/**
 * M20 근거 기록 목록(ANI-1783 2단계) 기능 플래그.
 *
 * 기본값은 OFF 다. 꺼져 있으면 `/app/results/:id/evidence` 는 존재하지 않는 화면이고
 * `/api/workspaces/:id/results/:metric/evidence` 는 404 다. 기존 성과·드릴다운 화면과
 * `/reports/weekly` 응답은 플래그와 무관하게 그대로다(PC 불변).
 *
 * 플래그를 켜도 화면은 R2 셸(`useMobileR2Active`)이 활성일 때만 그려진다 — 넓은 화면에는
 * 이 목록의 PC 대응 화면이 없으므로 성과 화면으로 돌려보낸다.
 */
export const EVIDENCE_LIST_R2_ENV = 'NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST'

/** 빌드 시 인라인되는 `NEXT_PUBLIC_*` 값. `on` 만 켜짐으로 본다(오타·빈 값은 OFF). */
export function isEvidenceListR2Enabled(
  value: string | undefined = process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST,
): boolean {
  return value === 'on'
}
