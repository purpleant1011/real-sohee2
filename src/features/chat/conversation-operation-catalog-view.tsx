'use client'

import { ArrowUpRight, Info, Megaphone, MessageCircle, NotebookPen } from 'lucide-react'
import { AppLink } from '@/components/navigation/app-link'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { ConversationOperation, ConversationOperationCatalog } from './conversation-operation-catalog'
import styles from './conversation-operation-catalog.module.css'

const groups = [
  { id: 'content', title: '홍보·콘텐츠', description: '기획부터 원고·사진 검토까지', icon: Megaphone },
  { id: 'customers', title: '고객·예약', description: '수신 내용과 실제 장부를 바탕으로', icon: MessageCircle },
  { id: 'operations', title: '운영·성과', description: '가게의 지식과 확인된 기록으로', icon: NotebookPen },
] as const

export function ConversationOperationCatalogView({ catalog, onSelect, embedded = false }: {
  catalog: ConversationOperationCatalog
  embedded?: boolean
  onSelect?: (operation: ConversationOperation) => void
}) {
  const readOnly = catalog.role === 'viewer'
  return <div className={styles.catalog}>
    {!embedded ? <header className={styles.header}>
      <div><p className={styles.eyebrow}>업무 탐색</p><h1>소희가 할 수 있는 일</h1>
        <p>대화로 요청하고, 실제 자료와 작업물을 확인한 뒤 결정하세요.</p></div>
      <Button asChild variant="outline"><AppLink href="/app/conversations">대화로 돌아가기</AppLink></Button>
    </header> : null}
    <Alert role="status"><Info aria-hidden="true" /><AlertTitle>기능은 모두 발견하고, 실행은 실제 권한에 따라</AlertTitle>
      <AlertDescription>{readOnly ? '읽기 전용 권한이에요. 업무 요청과 실행은 가게 관리자에게 문의해 주세요.'
        : '대화에 담아도 자동으로 전송되지 않아요. 연결된 계정이라는 사실만으로 게시·발송 권한이 생기지 않아요.'}</AlertDescription>
    </Alert>
    <nav aria-label="업무 분류" className={styles.quickNav}>
      {groups.map(group => <a href={`#catalog-${group.id}`} key={group.id}>{group.title}</a>)}
    </nav>
    <div className={styles.grid}>
      {groups.map(group => <Card id={`catalog-${group.id}`} className={styles.group} key={group.id}>
        <CardHeader><div className={styles.groupHeading}><group.icon aria-hidden="true" /><CardTitle><h2>{group.title}</h2></CardTitle></div>
          <CardDescription>{group.description}</CardDescription></CardHeader>
        <CardContent className={styles.content}><ul className={styles.operations}>
          {catalog.items.filter(item => item.group === group.id).map(operation => <li className={styles.operation} key={operation.id}>
            <div className={styles.operationHeading}><h3>{operation.title}</h3><Badge variant="secondary">{operation.stateLabel}</Badge></div>
            <p>{operation.description}</p>
            <div className={styles.actions}>
              {operation.prompt ? <Button className="min-h-11" size="sm" disabled={readOnly || !operation.canAsk || !onSelect}
                aria-label={`${operation.title} 대화에 담기`} onClick={() => onSelect?.(operation)}>대화에 담기</Button> : null}
              <Button className="min-h-11" asChild size="sm" variant="outline"><AppLink href={operation.directHref}
                aria-label={`${operation.title} 직접 열기`}>직접 열기<ArrowUpRight aria-hidden="true" data-icon="inline-end" /></AppLink></Button>
            </div>
          </li>)}
        </ul></CardContent>
        <CardFooter><p className={styles.footer}>작업물과 승인·이력은 기존 업무 화면과 함께 이어집니다.</p></CardFooter>
      </Card>)}
    </div>
    <p className={styles.notice}>초안 준비, 외부 요청 접수, 실제 결과 확인과 사업 성과는 서로 달라요. 확인되지 않은 일을 완료로 표시하지 않아요.</p>
  </div>
}
