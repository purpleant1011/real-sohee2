import dotenv from 'dotenv'
import fs from 'fs'

if (fs.existsSync('.env.local')) {
  const envConfig = dotenv.parse(fs.readFileSync('.env.local'))
  for (const k in envConfig) {
    process.env[k] = envConfig[k]
  }
}

async function markIssuesAsDone() {
  const apiKey = process.env.LINEAR_API_KEY
  if (!apiKey) {
    console.error("LINEAR_API_KEY is not set.")
    process.exit(1)
  }

  // 1. Get Done State ID for Team Ani
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
  const doneState = teamData.data.team.states.nodes.find(s => s.type === "completed" || s.name === "Done")
  if (!doneState) {
    console.error("Done state not found")
    process.exit(1)
  }
  console.log(`Found Done state: ${doneState.name} (${doneState.id})`)

  // 2. Fetch issues ANI-248 to ANI-262
  const issueNumbers = Array.from({ length: 15 }, (_, i) => 248 + i)
  for (const num of issueNumbers) {
    const ident = `ANI-${num}`
    const queryRes = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": apiKey },
      body: JSON.stringify({
        query: `query {
          issue(id: "${ident}") {
            id
            identifier
            title
          }
        }`
      })
    })
    const queryData = await queryRes.json()
    const issue = queryData.data?.issue
    if (issue) {
      // Update state to Done
      const updateRes = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": apiKey },
        body: JSON.stringify({
          query: `mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success
              issue {
                identifier
                state { name }
              }
            }
          }`,
          variables: {
            id: issue.id,
            input: { stateId: doneState.id }
          }
        })
      })
      const updateData = await updateRes.json()
      console.log(`✅ [${issue.identifier}] Marked as Done!`)
    }
  }
}

markIssuesAsDone().catch(console.error)
