import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ACTION_CAPABILITY_REGISTRY } from '@/lib/agent-os/action-capability-registry'
import { getOpenAIToolDefinitions } from '@/lib/agent-os/mcp-capability-registry'

describe('No Capability Theatre Contract (ANI-1034)', () => {
  const workerEntryPath = path.resolve(process.cwd(), 'worker-entry.js')
  const workerSource = fs.readFileSync(workerEntryPath, 'utf8')

  it('worker-entry.js must not contain duplicate Edge agent or fake business metrics', () => {
    expect(workerSource).not.toContain('SOHEE_MASTER_MCP_TOOLS')
    expect(workerSource).not.toContain('handleEdgeAgentChat')
    expect(workerSource).not.toContain('82.4%')
    expect(workerSource).not.toContain('2,450,000원')
    expect(workerSource).not.toContain('480%')
    expect(workerSource).not.toMatch(/unsplash\.com.*generate/i)
  })

  it('ACTION_CAPABILITY_REGISTRY contains valid action schemas without capability theatre', () => {
    expect(ACTION_CAPABILITY_REGISTRY['completely_fake_action']).toBeUndefined()
    for (const [key, action] of Object.entries(ACTION_CAPABILITY_REGISTRY)) {
      expect(action.id).toBe(key)
      expect(action.description).toBeTruthy()
      expect(action.riskTier).toMatch(/^(LOW|MEDIUM|HIGH|IRREVERSIBLE)$/)
    }
  })

  it('SOHEE_CAPABILITY_REGISTRY does not expose mock tools without canonical backing', () => {
    const tools = getOpenAIToolDefinitions()
    const toolNames = tools.map((t) => t.function.name)
    expect(toolNames).not.toContain('mcp_get_slot_occupancy')
    expect(toolNames).not.toContain('mcp_get_roi_analytics')
    expect(toolNames).not.toContain('mcp_get_labor_savings')
  })
})
