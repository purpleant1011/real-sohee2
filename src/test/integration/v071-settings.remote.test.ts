import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createRemoteTestContext,
  type RemoteTestContext,
} from './remote-harness'

describe('remote V0.7.1 operational settings', () => {
  let context: RemoteTestContext | undefined

  beforeAll(async () => {
    context = await createRemoteTestContext()
  })

  afterAll(async () => {
    await context?.cleanup()
  })

  it('lets an owner save scoped settings without exposing them to another workspace', async () => {
    if (!context) throw new Error('integration_context_missing')

    const { actorA, actorB } = context
    const business = {
      workspace_id: actorA.workspaceId,
      business_name: `V0.7.1 business ${context.runId}`,
      industry: '검증 업종',
      location: '서울',
      summary: '원격 운영 설정 권한 검증 자료',
    }
    const brand = {
      workspace_id: actorA.workspaceId,
      voice: '차분하고 검증 가능한 표현',
      keywords: ['검증', '안전'],
      prohibited_terms: ['무조건'],
    }
    const channel = {
      workspace_id: actorA.workspaceId,
      channel: 'instagram' as const,
      status: 'disconnected' as const,
      account_label: '@v071-verification',
    }
    const preferences = {
      workspace_id: actorA.workspaceId,
      user_id: actorA.userId,
      approval_events: true,
      schedule_events: false,
      publish_events: true,
    }

    const [businessInsert, brandInsert, channelInsert, preferenceInsert, memberSave] = await Promise.all([
      actorA.client.from('business_profiles').insert(business),
      actorA.client.from('brand_profiles').insert(brand),
      context.admin.from('channel_connections').insert(channel).select('id').single(),
      actorA.client.from('notification_preferences').insert(preferences),
      actorA.client.from('workspace_members')
        .update({ role: 'owner', status: 'active' })
        .eq('workspace_id', actorA.workspaceId)
        .eq('user_id', actorA.userId)
        .select('user_id'),
    ])

    expect(businessInsert.error).toBeNull()
    expect(brandInsert.error).toBeNull()
    expect(channelInsert.error).toBeNull()
    expect(channelInsert.data?.id).toBeTruthy()
    expect(preferenceInsert.error).toBeNull()
    expect(memberSave.error).toBeNull()
    expect(memberSave.data).toEqual([{ user_id: actorA.userId }])

    const updatedSummary = `${business.summary} 갱신`
    const updatedVoice = `${brand.voice} 갱신`
    const updatedLabel = '@v071-verified'
    const [businessUpdate, brandUpdate, channelUpdate, preferenceUpdate] = await Promise.all([
      actorA.client.from('business_profiles')
        .update({ summary: updatedSummary })
        .eq('workspace_id', actorA.workspaceId),
      actorA.client.from('brand_profiles')
        .update({ voice: updatedVoice })
        .eq('workspace_id', actorA.workspaceId),
      actorA.client.from('channel_connections')
        .update({ account_label: updatedLabel })
        .eq('workspace_id', actorA.workspaceId)
        .eq('id', channelInsert.data?.id ?? ''),
      actorA.client.from('notification_preferences')
        .update({ schedule_events: true })
        .eq('workspace_id', actorA.workspaceId)
        .eq('user_id', actorA.userId),
    ])

    expect(businessUpdate.error).toBeNull()
    expect(brandUpdate.error).toBeNull()
    expect(channelUpdate.error?.code).toBe('42501')
    expect(preferenceUpdate.error).toBeNull()

    const { error: adminChannelUpdateError } = await context.admin
      .from('channel_connections')
      .update({ account_label: updatedLabel })
      .eq('id', channelInsert.data?.id ?? '')

    expect(adminChannelUpdateError).toBeNull()

    const [businessRead, brandRead, channelRead, preferenceRead, foreignRead, foreignPreferenceRead, foreignWrite] = await Promise.all([
      actorA.client.from('business_profiles')
        .select('business_name, industry, location, summary')
        .eq('workspace_id', actorA.workspaceId)
        .single(),
      actorA.client.from('brand_profiles')
        .select('voice, keywords, prohibited_terms')
        .eq('workspace_id', actorA.workspaceId)
        .single(),
      actorA.client.from('channel_connections')
        .select('channel, status, account_label')
        .eq('workspace_id', actorA.workspaceId)
        .single(),
      actorA.client.from('notification_preferences')
        .select('approval_events, schedule_events, publish_events')
        .eq('workspace_id', actorA.workspaceId)
        .eq('user_id', actorA.userId)
        .single(),
      actorB.client.from('business_profiles')
        .select('workspace_id')
        .eq('workspace_id', actorA.workspaceId),
      actorB.client.from('notification_preferences')
        .select('workspace_id')
        .eq('workspace_id', actorA.workspaceId),
      actorB.client.from('channel_connections').insert({
        workspace_id: actorA.workspaceId,
        channel: 'youtube',
        status: 'disconnected',
        account_label: '@foreign-write-blocked',
      }),
    ])

    expect(businessRead.error).toBeNull()
    expect(businessRead.data).toEqual({
      business_name: business.business_name,
      industry: business.industry,
      location: business.location,
      summary: updatedSummary,
    })
    expect(brandRead.error).toBeNull()
    expect(brandRead.data).toEqual({
      voice: updatedVoice,
      keywords: brand.keywords,
      prohibited_terms: brand.prohibited_terms,
    })
    expect(channelRead.error).toBeNull()
    expect(channelRead.data).toEqual({
      channel: channel.channel,
      status: channel.status,
      account_label: updatedLabel,
    })
    expect(preferenceRead.error).toBeNull()
    expect(preferenceRead.data).toEqual({
      approval_events: preferences.approval_events,
      schedule_events: true,
      publish_events: preferences.publish_events,
    })
    expect(foreignRead.error).toBeNull()
    expect(foreignRead.data).toEqual([])
    expect(foreignPreferenceRead.error).toBeNull()
    expect(foreignPreferenceRead.data).toEqual([])
    expect(foreignWrite.error?.code).toBe('42501')
  })
})
