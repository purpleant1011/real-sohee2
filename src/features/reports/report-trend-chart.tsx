'use client'

import { ChartFrame } from '@/components/charts/chart-frame'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ReportTrendPoint } from './types'
import styles from './report-dashboard.module.css'

function trendSummary(points: readonly ReportTrendPoint[]) {
  const available = points.filter((point) => point.saved !== null)
  if (available.length < 2) return '수집 완료된 날짜가 더 생기면 변화 방향을 비교할 수 있어요.'
  const first = available[0].saved ?? 0
  const last = available.at(-1)?.saved ?? 0
  if (last === first) return '수집 완료된 저장 반응이 기간의 시작과 끝에서 같아요.'
  return `수집 완료된 저장 반응이 기간의 시작보다 ${Math.abs(last - first)}건 ${last > first ? '늘었어요' : '줄었어요'}.`
}

export function ReportTrendChart({ points }: Readonly<{ points: readonly ReportTrendPoint[] }>) {
  const table = (
    <table>
      <caption>7일 반응 추이 원자료</caption>
      <thead><tr><th>날짜</th><th>저장 반응</th><th>지난 주 저장 반응</th><th>문의</th></tr></thead>
      <tbody>{points.map((point) => <tr key={point.date}><th>{point.label}</th><td>{point.saved ?? '자료 없음'}</td><td>{point.previousSaved ?? '자료 없음'}</td><td>{point.inquiries ?? '자료 없음'}</td></tr>)}</tbody>
    </table>
  )

  return (
    <div className={styles.lineChart}>
      <div aria-label="차트 범례" className={styles.chartLegend}>
        <span data-series="saved">이번 주 저장 반응</span>
        <span data-series="previous">지난 주 저장 반응</span>
        <span data-series="inquiries">문의 전환</span>
      </div>
      <ChartFrame summary={trendSummary(points)} table={table} title="이번 주와 이전 주의 7일 반응 추이">
        <ResponsiveContainer height="100%" minHeight={270} width="100%">
          <LineChart accessibilityLayer aria-label="이번 주와 이전 주의 7일 반응 추이" data={points} role="img">
            <CartesianGrid stroke="var(--sohee-line)" strokeDasharray="3 4" vertical={false} />
            <XAxis axisLine={false} dataKey="label" fontSize={12} tickLine={false} />
            <YAxis allowDecimals={false} axisLine={false} fontSize={12} tickLine={false} width={34} />
            <Tooltip contentStyle={{ borderColor: 'var(--sohee-line)', borderRadius: '12px', boxShadow: 'var(--sohee-shadow-card)' }} />
            <Line connectNulls={false} dataKey="saved" dot={{ r: 4 }} name="이번 주 저장 반응" stroke="var(--sohee-accent)" strokeWidth={3} type="monotone" />
            <Line connectNulls={false} dataKey="previousSaved" dot={false} name="지난 주 저장 반응" stroke="#9b83ec" strokeDasharray="7 6" strokeWidth={2} type="monotone" />
            <Line connectNulls={false} dataKey="inquiries" dot={{ r: 3 }} name="문의 전환" stroke="var(--sohee-success)" strokeWidth={2} type="monotone" />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  )
}
