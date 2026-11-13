import { describe, expect, it } from 'vitest'
import { SOHEE_CAPABILITY_REGISTRY } from '@/lib/agent-os/mcp-capability-registry'

describe('grounded inbox capability contract', () => {
  it.each(['comment.reply_draft', 'dm.reply_draft'])('defines an internal-only draft with an exact source reference: %s', id => {
    const capability = SOHEE_CAPABILITY_REGISTRY[id]
    expect(capability).toMatchObject({ isWrite: true, requiresOwnerApproval: false, idempotencyRequired: true })
    expect(capability.parametersSchema.required).toEqual(['targetId', 'draftText', 'sourceRef'])
    expect(capability.description).toContain('발송하지 않습니다')
  })
  it('distinguishes stored comment and Instagram DM scopes instead of claiming unsupported channels', () => {
    const capability = SOHEE_CAPABILITY_REGISTRY['interaction.list']
    expect(capability.name).toContain('수집된')
    expect(capability.parametersSchema.properties.kind.enum).toEqual(['all', 'comments', 'dm'])
    expect(capability.parametersSchema.properties.channel.enum).toEqual(['all', 'instagram', 'threads', 'instagram_dm'])
  })
})
