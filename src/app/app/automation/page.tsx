'use client'

import React from 'react'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { AutomationWorkspace } from '@/features/automation/automation-workspace'

export default function AutomationPage() {
  return (
    <V088AppShell>
      <AutomationWorkspace />
    </V088AppShell>
  )
}
