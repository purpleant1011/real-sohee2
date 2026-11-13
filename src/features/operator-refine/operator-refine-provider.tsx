'use client'

import React, { type ReactNode } from 'react'
import type { OperatorPermission } from '@/features/operator-auth/permissions'

type Props = Readonly<{
  children: ReactNode
  pathname: string
  permissions: readonly OperatorPermission[]
}>

export function OperatorRefineProvider({ children, pathname, permissions }: Props) {
  return (
    <div data-operator-pathname={pathname} data-operator-permission-count={permissions.length}>
      {children}
    </div>
  )
}
