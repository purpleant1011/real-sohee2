'use client'

import React, { createContext, useContext } from 'react'

export type WorkspaceContextValue = {
  workspaceId: string
  workspaceName: string | null
  workspaceKind: string | null
  membershipRole: string
  actorId: string
  resolutionSource: 'membership' | 'explicit-selection'
  /** ANI-1779: 선택한 가게에 접근할 수 없어 다른 가게로 열린 경우. 화면에서 1회 안내한다. */
  workspaceSelectionFellBack?: boolean
  /** ANI-1779: 활성 가게가 2개 이상일 때만 true. false 면 셸은 선택기 대신 이름만 보여 준다. */
  workspaceCanSwitch?: boolean
  /** Server-controlled UI rollout; never grants domain execution authority. */
  conversationWorkbenchEnabled?: boolean
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({
  value,
  children,
}: {
  value: WorkspaceContextValue
  children: React.ReactNode
}) {
  if (!value || !value.workspaceId || value.workspaceId === 'ws-default') {
    throw new Error('INVALID_WORKSPACE_UUID: A valid canonical workspace UUID is required, ws-default is forbidden.')
  }

  // ANI-1779: 선택한 가게는 서버가 읽는 httpOnly 쿠키(`sohee_active_workspace_id`)로만 저장한다.
  // sessionStorage 에 따로 쓰면 서버 렌더와 화면이 서로 다른 가게를 가리킬 수 있어 제거했다.

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspaceContext(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)
  if (!context || !context.workspaceId || context.workspaceId === 'ws-default') {
    throw new Error('WORKSPACE_REQUIRED: Operation requires an authenticated WorkspaceContext.')
  }
  return context
}

export function useOptionalWorkspaceContext(): WorkspaceContextValue | null {
  const context = useContext(WorkspaceContext)
  if (!context || !context.workspaceId || context.workspaceId === 'ws-default') {
    return null
  }
  return context
}
