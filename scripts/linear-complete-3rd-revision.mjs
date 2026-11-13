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

async function run() {
  console.log('🔍 Fetching 3rd revision backlog issues from Linear...')
  const data = await queryLinear(`
    query {
      team(id: "fe9ce92a-6944-441c-8c02-6791df6e8061") {
        issues(first: 200, filter: { title: { contains: "[3차]" } }) {
          nodes {
            id
            identifier
            title
            state { id name type }
          }
        }
      }
    }
  `)

  const issues = data.team.issues.nodes
  console.log(`Found ${issues.length} 3rd revision issues. Updating verified issues to Done...`)

  let updatedCount = 0
  for (const iss of issues) {
    if (iss.state.type === 'completed') {
      console.log(`- [${iss.identifier}] Already Done: ${iss.title}`)
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
      { id: iss.id, stateId: DONE_STATE_ID }
    )

    if (updateRes?.issueUpdate?.success) {
      console.log(`✅ [${iss.identifier}] Completed -> Done: ${iss.title}`)
      updatedCount++
    } else {
      console.warn(`⚠️ [${iss.identifier}] Failed to update: ${iss.title}`)
    }
  }

  console.log(`\n🎉 Successfully completed ${updatedCount} Linear issues!`)
}

run()
