'use client'

import React from 'react'
import { PluginMarketplaceView } from '@/features/plugins/PluginMarketplaceView'
import { getDynamicActionRegistry } from '@/lib/agent-os/action-capability-registry'
import { getCategoryLabel, getRiskTierLabel } from '../tools-labels'

interface ToolsTabProps {
  workspaceId: string
  industry: string
  businessName: string
}

export function ToolsTab({ workspaceId, industry, businessName }: ToolsTabProps) {
  const actions = Object.values(getDynamicActionRegistry(industry, businessName))

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="font-extrabold text-base text-foreground">소희가 쓸 수 있는 기능</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {actions.map((act) => (
            <div
              key={act.id}
              className="p-5 rounded-3xl bg-card border border-border shadow-xs flex flex-col justify-between space-y-4 hover:border-primary/50 transition-all group"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                    {getCategoryLabel(act.category)}
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-primary/15 text-primary">
                    {getRiskTierLabel(act.riskTier)}
                  </span>
                </div>
                <div>
                  <h4 className="font-extrabold text-sm text-foreground group-hover:text-primary transition-colors">
                    {act.name}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                    {act.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <PluginMarketplaceView workspaceId={workspaceId} />
    </div>
  )
}
