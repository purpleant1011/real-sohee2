import type { assessProviderReadiness } from './provider-readiness'
type Readiness=ReturnType<typeof assessProviderReadiness>
const copy={supervised_allowed:['감독형 실행 준비됨','공식 정책과 대상, 결과 확인을 유지해 주세요.'],manual_assist_only:['수동 마무리만 가능','공식 화면에서 사용자가 직접 마무리해 주세요.'],unsupported:['지원하지 않음','공식 경로와 상업 계약을 먼저 확인해 주세요.']} as const
export function ProviderReadinessCard({name,readiness,sourceUrl}:Readonly<{name:string;readiness:Readiness;sourceUrl:string}>){const [title,action]=copy[readiness.decision];return <article aria-label={`${name} 공급자 준비도`}><p>공급자 준비도</p><h2>{name}</h2><strong>{title}</strong><p>{action}</p>{readiness.codeReuse==='code_reuse_forbidden'?<p>코드 재사용 금지</p>:null}<a href={sourceUrl} rel="noreferrer" target="_blank">공식 출처 열기</a></article>}
