const API_KEY = process.env.LINEAR_API_KEY || ''
const TEAM_ID = process.env.LINEAR_TEAM_ID || 'fe9ce92a-6944-441c-8c02-6791df6e8061'
const CUTOFF_MS = Date.now() - 15 * 60 * 1000

if (API_KEY.length < 20) {
  console.error('LINEAR_API_KEY_UNAVAILABLE')
  process.exit(1)
}

async function gql(query, variables = {}) {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  const body = await response.json()
  if (!response.ok || body.errors?.length || !body.data) {
    throw new Error(body.errors?.[0]?.message || `LINEAR_HTTP_${response.status}`)
  }
  return body.data
}

const issues = []
let after = null
for (let page = 0; page < 25; page += 1) {
  const data = await gql(`
    query BacklogSweep($teamId: String!, $first: Int!, $after: String) {
      team(id: $teamId) {
        issues(first: $first, after: $after) {
          nodes { id identifier archivedAt completedAt state { type } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `, { teamId: TEAM_ID, first: 100, after })
  if (!data.team) throw new Error('LINEAR_TEAM_NOT_FOUND')
  issues.push(...data.team.issues.nodes)
  if (!data.team.issues.pageInfo.hasNextPage) break
  after = data.team.issues.pageInfo.endCursor
  if (!after) throw new Error('LINEAR_CURSOR_MISSING')
}

const eligible = issues.filter((issue) => {
  if (issue.archivedAt || issue.state?.type !== 'completed' || !issue.completedAt) return false
  const completedAt = Date.parse(issue.completedAt)
  return Number.isFinite(completedAt) && completedAt <= CUTOFF_MS
})

let archived = 0
let failed = 0
for (let i = 0; i < eligible.length; i += 10) {
  const batch = eligible.slice(i, i + 10)
  const results = await Promise.allSettled(batch.map(async (issue) => {
    const data = await gql(`
      mutation ArchiveOne($id: String!) {
        issueArchive(id: $id) { success }
      }
    `, { id: issue.id })
    if (!data.issueArchive?.success) throw new Error(`ARCHIVE_FALSE_${issue.identifier}`)
  }))
  for (const result of results) {
    if (result.status === 'fulfilled') archived += 1
    else failed += 1
  }
}

console.log(JSON.stringify({ scanned: issues.length, eligible: eligible.length, archived, failed }))
if (failed > 0) process.exitCode = 1
