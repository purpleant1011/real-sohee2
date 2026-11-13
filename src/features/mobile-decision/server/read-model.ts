import { failed, type MobileHomeDto, type MobileApprovalView } from '../contracts'
import { approvalKey } from '../selectors'

export interface MobileReadContext { workspaceId: string; userId: string }
export interface MobileReadDeps {
  now: () => string
  readIdentity: (ctx: MobileReadContext) => Promise<{ businessName: string | null; timeZone: string | null }>
  readAgent: (ctx: MobileReadContext) => Promise<MobileHomeDto['agent']>
  readDecisions: (ctx: MobileReadContext) => Promise<MobileHomeDto['decisions']>
  readActivity: (ctx: MobileReadContext) => Promise<MobileHomeDto['activity']>
  readResults: (ctx: MobileReadContext) => Promise<MobileHomeDto['results']>
  readApproval: (ctx: MobileReadContext, key: string) => Promise<MobileApprovalView | null>
}

export async function readMobileHome(ctx: MobileReadContext, deps: MobileReadDeps): Promise<MobileHomeDto> {
  const capture = async <T,>(read: () => Promise<T>, fallback: T): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        read(),
        new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), 5_000) }),
      ])
    } catch { return fallback }
    finally { clearTimeout(timer) }
  }
  const [identity, agent, decisions, activity, results] = await Promise.all([
    capture(() => deps.readIdentity(ctx), { businessName: null, timeZone: null }),
    capture(() => deps.readAgent(ctx), failed()),
    capture(() => deps.readDecisions(ctx), failed()),
    capture(() => deps.readActivity(ctx), failed()),
    capture(() => deps.readResults(ctx), failed()),
  ])
  return { workspaceId: ctx.workspaceId, ...identity, generatedAt: deps.now(), agent, decisions, activity, results }
}

export async function readMobileApproval(ctx: MobileReadContext, key: string, deps: MobileReadDeps): Promise<MobileApprovalView | null> {
  if (!approvalKey(key)) return null
  const result = await deps.readApproval(ctx, key)
  return result?.workspaceId === ctx.workspaceId ? result : null
}
