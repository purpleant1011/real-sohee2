'use client'

import type { ReactNode } from 'react'
import type { OperatorPermission } from '@/features/operator-auth/permissions'
import { OperatorShell } from './operator-shell'

type Props = Readonly<{
  children: ReactNode
  pathname: string
  permissions: readonly OperatorPermission[]
  isReviewMode?: boolean
}>

export function OperatorClientShell({ children, pathname, permissions, isReviewMode = false }: Props) {
  return (
    <OperatorShell pathname={pathname} permissions={permissions} isReviewMode={isReviewMode}>
      {children}
    </OperatorShell>
  )
}

