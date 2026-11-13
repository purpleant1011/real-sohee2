import type { ReadbackPort } from './service'

type Channel = 'instagram' | 'threads'
type GetPort = { credential(workspaceId: string, channel: Channel): Promise<{ accessToken: string }>; get(input: { channel: Channel; providerPostId: string; accessToken: string }): Promise<string | null> }

/** Injected GET-only adapter. Never persists a success receipt or calls provider writes. */
export function createReadbackPort(deps: GetPort): ReadbackPort {
  return { async lookup({ workspaceId, channel, providerPostId }) {
    if (channel !== 'instagram' && channel !== 'threads') throw new Error('이 채널은 읽기 전용 재조회를 지원하지 않습니다.')
    if (!providerPostId) throw new Error('제공자 참조가 없어 재조회할 수 없습니다.')
    try {
      const credential = await deps.credential(workspaceId, channel)
      const permalink = await deps.get({ channel, providerPostId, accessToken: credential.accessToken })
      return { state: permalink ? 'FOUND' : 'UNKNOWN', observedAt: new Date().toISOString() }
    } catch {
      throw new Error('독립 조회에 실패했습니다. 재게시하지 마세요.')
    }
  } }
}

/** Import only on the authorized server route; provider GET is never called while rendering the queue. */
export const operatorReadbackPort = createReadbackPort({
  async credential(workspaceId, channel) {
    const { loadChannelCredentialByChannel } = await import('@/features/channels/credential-repository')
    return loadChannelCredentialByChannel(workspaceId, channel)
  },
  async get(input) {
    const { getPublishedMetaPostPermalink } = await import('@/lib/providers/meta-api')
    return getPublishedMetaPostPermalink(input)
  },
})
