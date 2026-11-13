'use client'

import type { ReactNode } from 'react'
import type { OperatorPermission } from '@/features/operator-auth/permissions'
import { OperatorRefineProvider } from '@/features/operator-refine/operator-refine-provider'
import { OperatorShell } from './operator-shell'

type Props = Readonly<{
  children: ReactNode
  pathname: string
  permissions: readonly OperatorPermission[]
}>

export function OperatorShellRuntime({ children, pathname, permissions }: Props) {
  return (
    <OperatorRefineProvider pathname={pathname} permissions={permissions}>
      <OperatorShell permissions={permissions} pathname={pathname}>{children}</OperatorShell>
    </OperatorRefineProvider>
  )
}
