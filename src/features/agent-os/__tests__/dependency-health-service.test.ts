import { describe, it, expect } from 'vitest'
import {
  computeOverallHealth,
  generateHealthSummary,
  getWorkspaceDependencyHealth,
  DEPENDENCY_METADATA,
} from '../dependency-health-service'

describe('Dependency & Sync Health Engine (ANI-849, ANI-871)', () => {
  it('aggregates 8 core dependencies correctly', async () => {
    const report = await getWorkspaceDependencyHealth('ws-123')

    expect(report.workspaceId).toBe('ws-123')
    expect(report.dependencies).toHaveLength(8)
    expect(report.overallStatus).toBe('HEALTHY')
    expect(report.headline).toBe('실시간 클라우드 동기화 정상')

    const keys = report.dependencies.map((d) => d.key)
    expect(keys).toContain('planner')
    expect(keys).toContain('queue')
    expect(keys).toContain('plugin_router')
    expect(keys).toContain('provider')
    expect(keys).toContain('event_ingestion')
    expect(keys).toContain('credit_ledger')
    expect(keys).toContain('evidence_store')
    expect(keys).toContain('scheduler')

    expect(report.description).not.toContain('완벽하게')
    expect(report.description).toContain('정상적으로 동기화')
    const sched = report.dependencies.find((d) => d.key === 'scheduler')
    expect(sched?.name).toBe('업무 스케줄러')
    expect(DEPENDENCY_METADATA.scheduler.name).not.toContain('24시간 자율')
    expect(DEPENDENCY_METADATA.queue.defaultDescription).not.toContain('보장')
  })

  it('downgrades overallStatus to DEGRADED if any dependency is degraded', async () => {
    const report = await getWorkspaceDependencyHealth('ws-123', {
      queue: { status: 'DEGRADED', message: '큐 처리 지연 (5건 대기 중)' },
    })

    expect(report.overallStatus).toBe('DEGRADED')
    expect(report.headline).toBe('일부 의존성 응답 지연')
    const queueDep = report.dependencies.find((d) => d.key === 'queue')
    expect(queueDep?.status).toBe('DEGRADED')
  })

  it('downgrades overallStatus to DOWN if any dependency is down even if others are healthy', async () => {
    const report = await getWorkspaceDependencyHealth('ws-123', {
      credit_ledger: { status: 'DOWN', message: '원장 데이터베이스 연결 끊김' },
      provider: { status: 'DEGRADED', message: '지연 발생' },
    })

    expect(report.overallStatus).toBe('DOWN')
    expect(report.headline).toBe('동기화 연결 차단됨')
  })

  it('sanitizes vendor technical names in dependency messages', async () => {
    const report = await getWorkspaceDependencyHealth('ws-123', {
      plugin_router: {
        status: 'DEGRADED',
        message: 'Postiz gateway connection timeout while talking to Chatwoot',
      },
    })

    const pluginDep = report.dependencies.find((d) => d.key === 'plugin_router')
    expect(pluginDep?.message).not.toContain('Postiz')
    expect(pluginDep?.message).not.toContain('Chatwoot')
    expect(pluginDep?.message).toContain('소희 외부 채널 게이트웨이')
    expect(pluginDep?.message).toContain('통합 고객 상담 라우터')
  })

  it('사장님 화면에 보이는 이름·설명에 개발자·결제 내부 용어를 쓰지 않는다', () => {
    const banned = ['큐', '게이트웨이', '라우터', '인프라', '멀티모달', '멱등', '원장', '크레딧', '백오프', '브레인', 'URL', '아카이브']
    for (const meta of Object.values(DEPENDENCY_METADATA)) {
      for (const word of banned) {
        expect(meta.name).not.toContain(word)
        expect(meta.defaultDescription).not.toContain(word)
      }
    }
  })
})
