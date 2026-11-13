export const LINEAR_DONE_ARCHIVE_AFTER_MS = 15 * 60 * 1000
export const ANI_TEAM_ID = 'fe9ce92a-6944-441c-8c02-6791df6e8061'

const PAGE_SIZE = 100
const MAX_PAGES = 25
const ARCHIVE_CONCURRENCY = 10

type LinearIssueNode = Readonly<{
  id: string
  identifier: string
  archivedAt: string | null
  completedAt: string | null
  state: Readonly<{ type: string }> | null
}>

type SweepDependencies = Readonly<{
  apiKey: string
  teamId?: string
  now?: () => number
  fetcher?: typeof fetch
}>

type GraphqlEnvelope<T> = Readonly<{
  data?: T
  errors?: readonly Readonly<{ message?: string }>[]
}>

async function linearGraphql<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<T> {
  const response = await fetcher('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) throw new Error(`LINEAR_API_HTTP_${response.status}`)
  const body = await response.json() as GraphqlEnvelope<T>
  if (!body.data || body.errors?.length) {
    throw new Error(body.errors?.[0]?.message ?? 'LINEAR_API_GRAPHQL_ERROR')
  }
  return body.data
}

async function listActiveTeamIssues(
  apiKey: string,
  teamId: string,
  fetcher: typeof fetch,
): Promise<LinearIssueNode[]> {
  const nodes: LinearIssueNode[] = []
  let after: string | null = null

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data: {
      team: null | {
        issues: {
          nodes: LinearIssueNode[]
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
        }
      }
    } = await linearGraphql(apiKey, `
      query SoheeLinearDoneSweep($teamId: String!, $first: Int!, $after: String) {
        team(id: $teamId) {
          issues(first: $first, after: $after) {
            nodes {
              id
              identifier
              archivedAt
              completedAt
              state { type }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `, { teamId, first: PAGE_SIZE, after }, fetcher)

    if (!data.team) throw new Error('LINEAR_TEAM_NOT_FOUND')
    nodes.push(...data.team.issues.nodes)
    if (!data.team.issues.pageInfo.hasNextPage) return nodes
    after = data.team.issues.pageInfo.endCursor
    if (!after) throw new Error('LINEAR_PAGE_CURSOR_MISSING')
  }

  throw new Error('LINEAR_SWEEP_PAGE_LIMIT_EXCEEDED')
}

function eligibleForArchive(issue: LinearIssueNode, cutoffMs: number) {
  if (issue.archivedAt || issue.state?.type !== 'completed' || !issue.completedAt) return false
  const completedAt = Date.parse(issue.completedAt)
  return Number.isFinite(completedAt) && completedAt <= cutoffMs
}

async function archiveOne(apiKey: string, issueId: string, fetcher: typeof fetch) {
  const data = await linearGraphql<{ issueArchive: { success: boolean } }>(apiKey, `
    mutation SoheeLinearArchiveOne($id: String!) {
      issueArchive(id: $id) { success }
    }
  `, { id: issueId }, fetcher)
  return data.issueArchive.success === true
}

export async function sweepLinearDoneIssues(dependencies: SweepDependencies) {
  const { apiKey } = dependencies
  if (apiKey.length < 20) throw new Error('LINEAR_API_KEY_UNAVAILABLE')

  const teamId = dependencies.teamId ?? ANI_TEAM_ID
  const now = dependencies.now ?? Date.now
  const fetcher = dependencies.fetcher ?? fetch
  const issues = await listActiveTeamIssues(apiKey, teamId, fetcher)
  const cutoffMs = now() - LINEAR_DONE_ARCHIVE_AFTER_MS
  const eligible = issues.filter((issue) => eligibleForArchive(issue, cutoffMs))

  let archived = 0
  let failed = 0

  for (let offset = 0; offset < eligible.length; offset += ARCHIVE_CONCURRENCY) {
    const batch = eligible.slice(offset, offset + ARCHIVE_CONCURRENCY)
    const results = await Promise.allSettled(batch.map(async (issue) => {
      if (!await archiveOne(apiKey, issue.id, fetcher)) throw new Error('LINEAR_ARCHIVE_FALSE')
      return issue.id
    }))
    for (const result of results) {
      if (result.status === 'fulfilled') archived += 1
      else failed += 1
    }
  }

  return {
    scanned: issues.length,
    eligible: eligible.length,
    archived,
    failed,
    cutoff: new Date(cutoffMs).toISOString(),
  }
}

export async function runProductionLinearDoneSweep(env: Readonly<Record<string, unknown>>) {
  const apiKey = typeof env.LINEAR_API_KEY === 'string' ? env.LINEAR_API_KEY : ''
  if (apiKey.length < 20) {
    console.error('Linear Done sweep skipped: LINEAR_API_KEY is unavailable')
    return { scanned: 0, eligible: 0, archived: 0, failed: 0, reason: 'unavailable' as const }
  }

  const teamId = typeof env.LINEAR_TEAM_ID === 'string' && env.LINEAR_TEAM_ID.length > 0
    ? env.LINEAR_TEAM_ID
    : ANI_TEAM_ID

  const result = await sweepLinearDoneIssues({ apiKey, teamId })
  console.log('Linear Done sweep completed', result)
  return result
}
