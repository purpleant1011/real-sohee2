import dotenv from 'dotenv'
import fs from 'fs'

if (fs.existsSync('.env.local')) {
  const envConfig = dotenv.parse(fs.readFileSync('.env.local'))
  for (const k in envConfig) {
    process.env[k] = envConfig[k]
  }
}

async function listProjectIssues() {
  const apiKey = process.env.LINEAR_API_KEY
  if (!apiKey) {
    console.error("LINEAR_API_KEY is not set.")
    process.exit(1)
  }

  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": apiKey },
    body: JSON.stringify({
      query: `query {
        project(id: "0a78fa08-d11a-4797-8817-b9e4e0f66868") {
          name
          issues {
            nodes {
              id
              identifier
              title
              state {
                name
                type
              }
            }
          }
        }
      }`
    })
  })

  const data = await res.json()
  const issues = data.data.project.issues.nodes
  console.log(`=== Linear Project: ${data.data.project.name} ===`)
  console.log(`Total Issues: ${issues.length}`)
  for (const issue of issues) {
    console.log(`[${issue.identifier}] [${issue.state.name}] ${issue.title}`)
  }
}

listProjectIssues().catch(console.error)
