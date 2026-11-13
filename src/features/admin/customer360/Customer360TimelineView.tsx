import type { Customer360Timeline } from './types'
import { referenceCode } from '@/components/admin-ui/labels'

const STATUS_LABEL = { ok: '조회됨', error: '조회 실패', not_connected: '연결 전', truncated: '일부 절단됨' } as const
const OUTCOME_LABEL = { ok: '성공', fail: '실패', unknown: '판정 불가', neutral: '' } as const

export function Customer360TimelineView({ data }: { data: Customer360Timeline }) {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-bold">고객 타임라인</h1>
        <p className="text-sm text-muted-foreground break-all">참조번호 {referenceCode(data.workspaceId)} · 읽기 전용 · 열람 기록이 남습니다</p>
      </header>

      <section aria-labelledby="c360-sources" className="space-y-2">
        <h2 id="c360-sources" className="text-base font-semibold">자료 출처 상태</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.sources.map((s, i) => (
            <li key={`${s.source}-${i}`} className="rounded-md border p-2 text-sm">
              <span className="font-medium">{s.label}</span>{' '}
              <span className={s.status === 'error' || s.status === 'truncated' ? 'font-semibold text-red-700' : 'text-muted-foreground'}>
                {STATUS_LABEL[s.status]}
              </span>
              {s.status === 'ok' ? <span className="text-muted-foreground"> · {s.count}건{s.count === 0 ? ' (기록 없음)' : ''}</span> : null}
              {s.status === 'truncated' ? <span className="text-muted-foreground"> · {s.count}건 (일부 누락)</span> : null}
              {s.message && (s.status === 'error' || s.status === 'truncated') ? <span className="block text-xs">{s.message}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="c360-chains" className="space-y-2">
        <h2 id="c360-chains" className="text-base font-semibold">왜 올라갔나 · 왜 안 올라갔나</h2>
        {data.chains.length === 0 ? <p className="text-sm text-muted-foreground">연결된 글·미션이 없습니다.</p> : null}
        {data.chains.map(chain => (
          <article key={chain.title} className="rounded-md border p-3 text-sm space-y-1">
            <h3 className="font-medium break-all">{chain.title}</h3>
            <ol className="flex flex-wrap items-center gap-1">
              {chain.steps.map((step, i) => (
                <li key={`${step.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 ? <span aria-hidden="true">→</span> : null}
                  {step.href ? <a className="underline" href={step.href}>{step.label}</a> : <span className="text-muted-foreground">{step.label}</span>}
                </li>
              ))}
            </ol>
            <p>{chain.verdict}</p>
          </article>
        ))}
      </section>

      <section aria-labelledby="c360-events" className="space-y-2">
        <h2 id="c360-events" className="text-base font-semibold">시간순 기록</h2>
        {data.events.length === 0 ? <p className="text-sm text-muted-foreground">조회된 기록이 없습니다. 위 자료 출처 상태에서 조회 실패가 있는지 확인하세요.</p> : null}
        <ol className="space-y-2">
          {data.events.map(e => (
            <li key={e.canonicalId} id={e.canonicalId} className="rounded-md border p-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <time dateTime={e.occurredAt}>{e.occurredAt.replace('T', ' ').slice(0, 19)}</time>
                <span className="font-medium">{e.title}</span>
                {OUTCOME_LABEL[e.outcome] ? <span className={e.outcome === 'fail' ? 'text-red-700 font-semibold' : ''}>{OUTCOME_LABEL[e.outcome]}</span> : null}
              </div>
              {e.detail ? <p className="break-words text-muted-foreground">{e.detail}</p> : null}
              <span className="text-xs text-muted-foreground">참조번호 {referenceCode(e.canonicalId.split(':').pop())}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
