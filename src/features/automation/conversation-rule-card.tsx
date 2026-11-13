import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'

type RuleProposal = Readonly<{
  name: string
  schedule: string
  timezone: string
  channels: readonly string[]
  perRunCreditCap: number
  dailyCreditCap: number
  weeklyCreditCap: number
  quietHours: Readonly<{ start: string; end: string }>
  active: boolean
}>

function formatTime(value: string): string {
  const [hour, minute] = value.split(':').map(Number)
  const period = hour! < 12 ? '오전' : '오후'
  const displayHour = hour! % 12 || 12
  return `${period} ${displayHour}:${minute!.toString().padStart(2, '0')}`
}

export function ConversationRuleCard({ proposal }: Readonly<{ proposal: RuleProposal }>) {
  const mobile = useMobileR2Active()

  return <article aria-label="자동화 제안" data-v08-screen="AU-01">
    <p>자동화 제안</p><h2>{proposal.name}</h2><p>{proposal.schedule} · {proposal.timezone}</p>
    <p>대상 채널: {proposal.channels.join(', ')}</p>
    <dl>
      {!mobile ? (
        <>
          <div><dt>예상 실행 비용</dt><dd>{`한 번 최대 ${proposal.perRunCreditCap} 크레딧`}</dd></div>
          <div><dt>비용 한도</dt><dd><span>{`하루 최대 ${proposal.dailyCreditCap} 크레딧`}</span> · <span>{`일주일 최대 ${proposal.weeklyCreditCap} 크레딧`}</span></dd></div>
        </>
      ) : null}
      <div><dt>조용한 시간</dt><dd>{`조용한 시간 ${formatTime(proposal.quietHours.start)}부터 ${formatTime(proposal.quietHours.end)}`}</dd></div>
    </dl>
    <p>{proposal.active ? '활성' : '비활성'}</p><p>저장 전까지 자동화는 실행되지 않아요.</p>
    <div><button disabled>이대로 저장</button><button disabled>시간 바꾸기</button><button disabled>채널 바꾸기</button><button disabled>한도 바꾸기</button><button disabled>취소</button></div>
  </article>
}
