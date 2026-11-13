import { MODE_POLICY, resolveBottomSurface } from './modes'
import { resolveRoute } from './routes'
import { tabRootHref } from './tabs'
import type { ResolvedSurface, ShellScreenConfig } from './types'

/**
 * 라우트 맵 + 화면 등록 설정 → 실제로 그릴 표면(순수 함수).
 * 규칙 위반은 조용히 보정하고(예: BROWSE 의 CTA 무시) 위반 목록을 돌려준다(개발 경고용).
 */
export function resolveSurface(pathname: string, config: ShellScreenConfig | null): { surface: ResolvedSurface; violations: string[] } {
  const route = resolveRoute(pathname)
  const mode = config?.mode ?? route?.mode ?? 'BROWSE'
  const policy = MODE_POLICY[mode]
  const violations: string[] = []

  let cta = config?.cta ?? null
  if (cta && policy.cta === 'forbidden') {
    violations.push(`${mode} 모드에서는 고정 CTA 를 쓸 수 없어요`)
    cta = null
  }
  if (!cta && policy.cta === 'required') violations.push(`${mode} 모드에는 단일 고정 CTA 가 필요해요`)
  if (cta && cta.disabled && !cta.disabledReason) violations.push('비활성 CTA 에는 disabledReason 이 필요해요')

  const backHref = config?.backHref ?? route?.backFallback ?? (route?.tab ? tabRootHref(route.tab) : null)
  return {
    surface: {
      mode,
      policy,
      bottom: resolveBottomSurface(mode, cta !== null),
      title: config?.title ?? route?.title ?? '',
      backHref: policy.header === 'back' ? backHref : null,
      actions: config?.actions ?? [],
      cta,
      status: config?.status ?? null,
    },
    violations,
  }
}
