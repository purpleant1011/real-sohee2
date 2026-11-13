import fs from 'node:fs'
import dotenv from 'dotenv'

if (fs.existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' })
} else {
  dotenv.config()
}

const LINEAR_API_KEY = process.env.LINEAR_API_KEY
if (!LINEAR_API_KEY) {
  console.error('❌ No LINEAR_API_KEY found!')
  process.exit(1)
}

const DONE_STATE_ID = '1ba18dd4-0aec-422d-94b3-1bf984bc658a'

async function queryLinear(query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors) {
    console.error('Linear Error:', JSON.stringify(json.errors, null, 2))
  }
  return json.data
}

const targetIdentifiers = [
  'ANI-194',
  'ANI-264',
  'ANI-284',
  'ANI-308',
  'ANI-311',
  'ANI-313',
  'ANI-316',
  'ANI-320',
  'ANI-322',
  'ANI-433',
]

async function run() {
  console.log(`🔍 Updating ${targetIdentifiers.length} remaining verified issues to Done...`)

  let updatedCount = 0
  for (const ident of targetIdentifiers) {
    const issueData = await queryLinear(
      `
      query GetIssue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          state { id name type }
        }
      }
    `,
      { id: ident }
    )

    const issue = issueData?.issue
    if (!issue) {
      console.warn(`⚠️ Issue not found: ${ident}`)
      continue
    }

    if (issue.state.type === 'completed') {
      console.log(`- [${issue.identifier}] Already Done: ${issue.title}`)
      continue
    }

    const updateRes = await queryLinear(
      `
      mutation UpdateIssueState($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) {
          success
          issue { id identifier title state { name } }
        }
      }
    `,
      { id: issue.id, stateId: DONE_STATE_ID }
    )

    if (updateRes?.issueUpdate?.success) {
      console.log(`✅ [${issue.identifier}] Completed -> Done: ${issue.title}`)
      updatedCount++
    } else {
      console.warn(`⚠️ [${issue.identifier}] Failed to update: ${issue.title}`)
    }
  }

  console.log(`\n🎉 Successfully completed all ${updatedCount} remaining Linear issues!`)
}

run()
