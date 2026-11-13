import { ArrowRight, BookOpenCheck, CalendarRange, MessageSquareText } from 'lucide-react'
import { AppLink as Link } from '@/components/navigation/app-link'
import type { ReportDecisionSummary } from './report-decision-repository'
import styles from './report-dashboard.module.css'

const variableLabels = {
  opening: '첫 문장',
  format: '콘텐츠 형식',
  cta: '행동 제안',
  timing: '게시 시각',
  other: '한 가지 변수',
} as const

export function ReportDecisionLedger({ decisions }: Readonly<{ decisions: readonly ReportDecisionSummary[] }>) {
  return (
    <section aria-labelledby="decision-ledger-title" className={styles.decisionLedger}>
      <header>
        <div><p>리포트 · <strong>의사결정 기록</strong></p><h1 id="decision-ledger-title">무엇을 보고, 무엇을 바꿨는지 남겨요</h1><span>관찰한 인사이트를 바탕으로 무엇을 결정하고, 어떻게 실행했으며, 어떤 결과가 있었는지 기록합니다.</span></div>
        <span>{decisions.length}개의 실제 기록</span>
      </header>
      <h2 className={styles.srOnly}>의사결정 기록</h2>
      <nav aria-label="의사결정 기록 필터" className={styles.ledgerFilters}><button type="button">최근 90일</button><button type="button">전체 상태</button><button type="button">전체 채널</button><button aria-label="의사결정 기록 검색" type="button">검색</button></nav>
      {decisions.length === 0 ? <div className={styles.ledgerEmpty}>
        <BookOpenCheck aria-hidden="true" />
        <h2>의사결정 기록</h2><strong>아직 저장된 의사결정이 없어요.</strong>
        <p>브리핑에서 다음 포스팅 방향을 정하면 관찰과 실행 결과가 여기에 이어져요.</p>
        <Link href="/app/reports">경영 브리핑으로 돌아가기</Link>
      </div> : <ol className={styles.ledgerList}>{decisions.map((decision, index) => (
        <li key={decision.id}>
          <details open={index === 0}>
            <summary>
              <div><span>{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(new Date(decision.createdAt))}</span><strong>{decision.observedFacts[0] ?? decision.insightKey}</strong></div>
              <span>{decision.status === 'result_ready' ? '결과 확인' : decision.experimentId ? '실험 계획됨' : '판단 저장됨'}</span>
            </summary>
            <div className={styles.ledgerFlow}>
              <section><span>관찰</span><p>{decision.observedFacts[0] ?? '연결된 관찰 문장을 확인하는 중이에요.'}</p></section>
              <ArrowRight aria-hidden="true" />
              <section><span>판단</span><p>{decision.hypothesis}</p><small>{variableLabels[decision.changeVariable]}만 변경</small></section>
              <ArrowRight aria-hidden="true" />
              <section><span>실행 계획</span><p>{decision.experimentId ? '두 정확한 버전을 비교할 계획이에요.' : '대화에서 다음 실행을 정하는 중이에요.'}</p></section>
              <ArrowRight aria-hidden="true" />
              <section><span>{decision.status === 'result_ready' ? '결과' : '결과 확인 전'}</span><p>{decision.status === 'result_ready' ? '수집된 결과를 검토할 차례예요.' : '실행 뒤 같은 지표로 비교해요.'}</p></section>
            </div>
            <footer>
              <span>근거 버전 {decision.evidenceVersionIds.length}개</span>
              {decision.conversationThreadId ? <Link href={`/app/conversations/${decision.conversationThreadId}`}><MessageSquareText aria-hidden="true" />연결된 대화 보기</Link> : null}
              {decision.experimentId ? <Link href={`/app/schedule?experiment=${decision.experimentId}`}><CalendarRange aria-hidden="true" />실험 일정 보기</Link> : null}
            </footer>
          </details>
        </li>
      ))}</ol>}
      <aside><BookOpenCheck aria-hidden="true" /><div><strong>학습은 자동으로 미래 콘텐츠에 반영되지 않아요.</strong><span>결과를 확인한 뒤 기존 학습 검토 화면에서 소유자나 관리자가 승인해야 재사용돼요.</span></div></aside>
    </section>
  )
}
