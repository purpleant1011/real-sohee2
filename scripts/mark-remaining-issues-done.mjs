import dotenv from 'dotenv'
import fs from 'fs'

if (fs.existsSync('.env.local')) {
  const envConfig = dotenv.parse(fs.readFileSync('.env.local'))
  for (const k in envConfig) {
    process.env[k] = envConfig[k]
  }
}

async function markRemainingIssuesDone() {
  const apiKey = process.env.LINEAR_API_KEY
  if (!apiKey) {
    console.error("LINEAR_API_KEY is not set.")
    process.exit(1)
  }

  // Get Done state ID
  const teamRes = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": apiKey },
    body: JSON.stringify({
      query: `query {
        team(id: "fe9ce92a-6944-441c-8c02-6791df6e8061") {
          states {
            nodes {
              id
              name
              type
            }
          }
        }
      }`
    })
  })
  const teamData = await teamRes.json()
  const doneState = teamData.data.team.states.nodes.find(s => s.name === "Done" || s.type === "completed")

  const targetIssues = [
    'ANI-248', 'ANI-249', 'ANI-250', 'ANI-251', 'ANI-253',
    'ANI-255', 'ANI-256', 'ANI-258', 'ANI-259', 'ANI-261', 'ANI-262'
  ]

  for (const ident of targetIssues) {
    const qRes = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": apiKey },
      body: JSON.stringify({
        query: `query { issue(id: "${ident}") { id } }`
      })
    })
    const qData = await qRes.json()
    const issueId = qData.data?.issue?.id
    if (issueId) {
      await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": apiKey },
        body: JSON.stringify({
          query: `mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success
              issue { identifier state { name } }
            }
          }`,
          variables: {
            id: issueId,
            input: { stateId: doneState.id }
          }
        })
      })
      console.log(`✅ [${ident}] Updated to Done`)
    }
  }
}

markRemainingIssuesDone().catch(console.error)
