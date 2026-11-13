/**
 * R2 모바일 UI 노출 플래그(ANI-1770). 기본 OFF.
 * 'all'은 모든 인가 매장에 공개, '1'은 allowlist 한정이다. '*'는 전체 허용으로 해석하지 않는다.
 * 브라우저 저장소·URL은 노출 권한을 주지 않는다(서버가 계산해 내려준다).
 */
export function resolveMobileR2Enabled(flag: string | undefined, raw: string | undefined, workspaceId: string): boolean {
  if (!workspaceId) return false
  if (flag === 'all') return true
  const allowed = (raw ?? '').split(',').map(value => value.trim()).filter(Boolean)
  return flag === '1' && Boolean(workspaceId) && !allowed.includes('*') && allowed.includes(workspaceId)
}

/**
 * 공개 첫 화면(M01 `/`)의 R2 랜딩 플래그(ANI-1672). 기본 OFF.
 *
 * 이 경로는 비로그인 진입점이라 매장(workspace)이 없다 — 그래서 allowlist 로 좁힐 수 없고
 * 배포 환경변수 하나로만 켠다. 켜져도 좁은 화면에서만 랜딩이 보이고, 넓은 화면은 기존
 * V0.85 랜딩을 그대로 쓴다(`useMobileR2Active`).
 */
export function resolveMobileR2LandingEnabled(flag: string | undefined): boolean {
  return flag === '1'
}
