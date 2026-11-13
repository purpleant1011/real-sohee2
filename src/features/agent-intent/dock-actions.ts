export type DockAction =
  | { type: 'navigate'; path: string }
  | { type: 'create_post'; topic: string }
  | { type: 'open_content'; missionId?: string }
  | { type: 'connect_channel'; channel: 'instagram' | 'threads' }
  | { type: 'show_results' }
  | {
      type: 'register_reservation'
      customerName: string
      customerPhone?: string
      suggestedTime?: string
      serviceName?: string
    }
  | { type: 'pause_mission'; missionId: string }
  | { type: 'propose_plan_diff'; missionId: string; description?: string; rawQuery?: string }

export type DockIntentResult = { reply: string; actions: DockAction[] }

const NAVIGATION_PATHS = new Set(['/app', '/app/content', '/app/customers', '/app/results', '/app/sohee', '/app/ads', '/app/system', '/app/missions'])
const MISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Never use untrusted paths or unknown action types returned by an API as router targets.
export function parseDockActions(value: unknown): DockAction[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 10).flatMap((entry): DockAction[] => {
    if (!entry || typeof entry !== 'object') return []
    const action = entry as Record<string, unknown>
    switch (action.type) {
      case 'navigate':
        return typeof action.path === 'string' && NAVIGATION_PATHS.has(action.path)
          ? [{ type: 'navigate', path: action.path }] : []
      case 'create_post': {
        if (typeof action.topic !== 'string') return []
        const topic = action.topic.trim()
        return topic.length > 0 && topic.length <= 300 ? [{ type: 'create_post', topic }] : []
      }
      case 'open_content':
        if (action.missionId === undefined) return [{ type: 'open_content' }]
        return typeof action.missionId === 'string' && MISSION_ID.test(action.missionId)
          ? [{ type: 'open_content', missionId: action.missionId }] : []
      case 'connect_channel':
        return action.channel === 'instagram' || action.channel === 'threads'
          ? [{ type: 'connect_channel', channel: action.channel }] : []
      case 'show_results':
        return [{ type: 'show_results' }]
      case 'register_reservation': {
        if (typeof action.customerName !== 'string' || !action.customerName.trim()) return []
        return [
          {
            type: 'register_reservation',
            customerName: action.customerName.trim().slice(0, 50),
            customerPhone: typeof action.customerPhone === 'string' ? action.customerPhone.trim().slice(0, 20) : undefined,
            suggestedTime: typeof action.suggestedTime === 'string' ? action.suggestedTime.trim().slice(0, 50) : undefined,
            serviceName: typeof action.serviceName === 'string' ? action.serviceName.trim().slice(0, 100) : undefined,
          },
        ]
      }
      case 'pause_mission':
        return typeof action.missionId === 'string' && MISSION_ID.test(action.missionId)
          ? [{ type: 'pause_mission', missionId: action.missionId }] : []
      case 'propose_plan_diff':
        return typeof action.missionId === 'string' && MISSION_ID.test(action.missionId)
          ? [
              {
                type: 'propose_plan_diff',
                missionId: action.missionId,
                ...(typeof action.description === 'string' && action.description.trim()
                  ? { description: action.description.trim().slice(0, 300) }
                  : {}),
                ...(typeof action.rawQuery === 'string' && action.rawQuery.trim()
                  ? { rawQuery: action.rawQuery.trim().slice(0, 300) }
                  : {}),
              },
            ] : []
      default:
        return []
    }
  })
}

export function serializeDockActions(actions: unknown): string {
  return JSON.stringify(parseDockActions(actions))
}
