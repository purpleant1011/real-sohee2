import dotenv from 'dotenv'
import fs from 'fs'

if (fs.existsSync('.env.local')) {
  const envConfig = dotenv.parse(fs.readFileSync('.env.local'))
  for (const k in envConfig) {
    process.env[k] = envConfig[k]
  }
}

async function updateLinearHonestStatus() {
  const apiKey = process.env.LINEAR_API_KEY
  if (!apiKey) {
    console.error("LINEAR_API_KEY is not set.")
    process.exit(1)
  }

  // Get In Progress state ID
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
  const inProgressState = teamData.data.team.states.nodes.find(s => s.name === "In Progress" || s.type === "started")
  const doneState = teamData.data.team.states.nodes.find(s => s.name === "Done" || s.type === "completed")

  // Completed items (Frontend UI, Platform Adapter, Safety Gate, 7 Fixtures)
  const completedIssues = ['ANI-252', 'ANI-254', 'ANI-257', 'ANI-260']
  // In Progress items (Underlying DB persistence, Real LLM Vision compilation, Live Playwright crawl, DB RPC)
  const inProgressIssues = ['ANI-248', 'ANI-249', 'ANI-250', 'ANI-251', 'ANI-253', 'ANI-255', 'ANI-256', 'ANI-258', 'ANI-259', 'ANI-261', 'ANI-262']

  for (const ident of inProgressIssues) {
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
            input: { stateId: inProgressState.id }
          }
        })
      })
      console.log(`🔄 [${ident}] Updated to In Progress`)
    }
  }
}

updateLinearHonestStatus().catch(console.error)
