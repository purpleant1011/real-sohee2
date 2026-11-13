'use client'

import dynamic from 'next/dynamic'
import type { OperatorAdminAccountsProps } from '@/features/operator-admin/operator-admin-accounts'
import type { AuditReadConsoleProps } from '@/features/operator-audit/audit-read-console'
import type { BillingOverviewProps } from '@/features/operator-billing/billing-overview'
import type { ChannelSummaryProps } from '@/features/operator-channels/channel-summary'
import type { OperatorCrmDashboardProps } from '@/features/operator-dashboard/operator-crm-dashboard'
import type { OnboardingBoardProps } from '@/features/operator-onboarding/onboarding-board'
import type { OperatorAdminViewProps } from '@/features/operator-publishing/operator-admin-view'
import type { WorkspaceDetailProps } from '@/features/operator-workspaces/workspace-detail'
import type { WorkspaceListProps } from '@/features/operator-workspaces/workspace-list'

const Dashboard = dynamic(
  () => import('@/features/operator-dashboard/operator-crm-dashboard').then((module) => module.OperatorCrmDashboard),
  { ssr: false, loading: () => <main aria-busy="true" aria-label="운영 현황 불러오는 중" /> },
)
const WorkspaceList = dynamic(
  () => import('@/features/operator-workspaces/workspace-list'),
  { ssr: false, loading: () => <div aria-busy="true" aria-label="고객사 목록 불러오는 중" /> },
)
const WorkspaceDetail = dynamic(
  () => import('@/features/operator-workspaces/workspace-detail'),
  { ssr: false, loading: () => <main aria-busy="true" aria-label="고객사 상세 불러오는 중" /> },
)
const OnboardingBoard = dynamic(
  () => import('@/features/operator-onboarding/onboarding-board'),
  { ssr: false, loading: () => <main aria-busy="true" aria-label="가입 계약 화면 불러오는 중" /> },
)
const ChannelSummary = dynamic(
  () => import('@/features/operator-channels/channel-summary'),
  { ssr: false, loading: () => <main aria-busy="true" aria-label="채널 화면 불러오는 중" /> },
)
const AdminView = dynamic(
  () => import('@/features/operator-publishing/operator-admin-view').then((module) => module.OperatorAdminView),
  { ssr: false, loading: () => <main aria-busy="true" aria-label="운영 자료 화면 불러오는 중" /> },
)
const BillingOverview = dynamic(
  () => import('@/features/operator-billing/billing-overview'),
  { ssr: false, loading: () => <main aria-busy="true" aria-label="결제 크레딧 화면 불러오는 중" /> },
)
const AdminAccounts = dynamic(
  () => import('@/features/operator-admin/operator-admin-accounts').then((module) => module.OperatorAdminAccounts),
  { ssr: false, loading: () => <main aria-busy="true" aria-label="관리자 계정 화면 불러오는 중" /> },
)
const AuditConsole = dynamic(
  () => import('@/features/operator-audit/audit-read-console').then((module) => module.AuditReadConsole),
  { ssr: false, loading: () => <main aria-busy="true" aria-label="감사 기록 화면 불러오는 중" /> },
)

export function DynamicOperatorCrmDashboard(props: OperatorCrmDashboardProps) {
  return <Dashboard {...props} />
}

export function DynamicWorkspaceList(props: WorkspaceListProps) {
  return <WorkspaceList {...props} />
}

export function DynamicWorkspaceDetail(props: WorkspaceDetailProps) {
  return <WorkspaceDetail {...props} />
}

export function DynamicOnboardingBoard(props: OnboardingBoardProps) { return <OnboardingBoard {...props} /> }
export function DynamicChannelSummary(props: ChannelSummaryProps) { return <ChannelSummary {...props} /> }
export function DynamicOperatorAdminView(props: OperatorAdminViewProps) { return <AdminView {...props} /> }
export function DynamicBillingOverview(props: BillingOverviewProps) { return <BillingOverview {...props} /> }
export function DynamicOperatorAdminAccounts(props: OperatorAdminAccountsProps) { return <AdminAccounts {...props} /> }
export function DynamicAuditReadConsole(props: AuditReadConsoleProps) { return <AuditConsole {...props} /> }
