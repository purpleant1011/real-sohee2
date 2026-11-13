'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { BlogStrategyBriefing } from '@/features/chat/blog-strategy-briefing'
import type { BlogStrategyProposal } from '@/features/chat/blog-strategy-proposal'

type Scenario = 'unselected' | 'selected' | 'dirty' | 'approved' | 'blocked'
const example: BlogStrategyProposal = {
  id: '10000000-0000-4000-8000-000000000001', revision: 1, status: 'proposed', selectedIndex: 0,
  goal: { description: '처음 이용을 검토하는 분의 유효한 상담 문의 늘리기' },
  audience: '첫 이용을 고민하는 분', constraints: '확인하지 않은 가격·할인이나 이용 후기는 넣지 않기',
  topics: ['첫 이용 전 확인할 서비스 안내', '상담 전에 준비할 내용', '서비스 선택 시 확인할 사항'].map(title => ({
    title, evidence: ['테스트 가게 정보: 서비스 내용은 상담 후 안내합니다.', '테스트 가게 정보: 문의는 가게가 안내한 연락 수단으로 받습니다.'], questionSource: 'inferred',
  })), unknowns: ['검색 수요와 실제 고객 질문은 관측하지 않았어요.', '문의·예약·판매 성과와 AI 답변 노출은 측정하지 않았어요.'],
}

export function BlogStrategyReviewPreview() {
  const [scenario, setScenario] = useState<Scenario>('selected')
  const [topic, setTopic] = useState(0)
  return <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
    <header className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">블로그 성장 브리핑 · 화면 검토</h1>
      <p className="text-sm text-muted-foreground">테스트 전용 예시예요. 실제 가게·고객 데이터가 아니며 저장·승인·크레딧 차감·원고 생성·외부 게시를 실행하지 않아요.</p>
      <a className="min-h-11 py-3 text-sm underline" href="/dev/blog-strategy">대화 연결 검증 화면으로 이동</a>
    </header>
    <Card>
      <CardHeader><CardTitle>확인할 화면 상태</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Label htmlFor="preview-state">시나리오</Label>
        <select id="preview-state" value={scenario} onChange={event => setScenario(event.target.value as Scenario)} className="min-h-11 w-full rounded-md border bg-background px-3">
          <option value="unselected">주제 선택 전</option>
          <option value="selected">선택·조건 저장 후</option>
          <option value="dirty">수정 후 아직 저장하지 않음</option>
          <option value="approved">전략 승인 후</option>
          <option value="blocked">정보 변경으로 진행 차단</option>
        </select>
        <Label htmlFor="preview-topic">저장한 주제 예시</Label>
        <select id="preview-topic" value={topic} onChange={event => setTopic(Number(event.target.value))} className="min-h-11 w-full rounded-md border bg-background px-3">
          {example.topics.map((item, index) => <option value={index} key={item.title}>{item.title}</option>)}
        </select>
        <Button variant="outline" onClick={() => { setScenario('selected'); setTopic(0) }}>예시 처음으로</Button>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>소희의 다음 업무 제안</CardTitle></CardHeader>
      <CardContent>
        <BlogStrategyBriefing proposal={{ ...example, selectedIndex: scenario === 'unselected' ? null : topic,
          status: scenario === 'approved' || scenario === 'blocked' ? 'approved' : 'proposed' }}
          dirty={scenario === 'dirty'} blocked={scenario === 'blocked'} />
      </CardContent>
    </Card>
    <p className="text-sm text-muted-foreground">이 화면은 제품과 같은 브리핑 컴포넌트를 사용해요. 운영 데이터 저장·권한·비용 확인·게시 검증은 포함하지 않아요.</p>
  </main>
}
