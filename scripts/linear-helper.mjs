import 'dotenv/config'

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) {
  console.error("LINEAR_API_KEY is not set.");
  process.exit(1);
}

const STATE_MAP = {
  backlog: "01d738da-ef4b-42de-b6d6-ad7be76c75dc",
  todo: "744022e9-9015-442e-a82a-d914c17d1646",
  in_progress: "5454c65b-bd8a-4df3-bf7a-452ce057061b",
  done: "1ba18dd4-0aec-422d-94b3-1bf984bc658a"
};

export async function updateIssueState(identifierOrId, stateKey) {
  const stateId = STATE_MAP[stateKey.toLowerCase()];
  if (!stateId) {
    throw new Error(`Unknown stateKey: ${stateKey}. Valid keys: backlog, todo, in_progress, done`);
  }

  // Find issue ID if identifier (like ANI-170) is provided
  let issueId = identifierOrId;
  if (identifierOrId.startsWith("ANI-")) {
    const getQuery = `
      query GetIssue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          state { name }
        }
      }
    `;
    const getRes = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": apiKey },
      body: JSON.stringify({ query: getQuery, variables: { id: identifierOrId } })
    });
    const getData = await getRes.json();
    if (!getData?.data?.issue?.id) {
      throw new Error(`Issue not found: ${identifierOrId}`);
    }
    issueId = getData.data.issue.id;
  }

  const updateMutation = `
    mutation UpdateIssueState($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) {
        success
        issue {
          id
          identifier
          title
          state { id name type }
        }
      }
    }
  `;

  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": apiKey },
    body: JSON.stringify({ query: updateMutation, variables: { id: issueId, stateId } })
  });
  const data = await res.json();
  return data?.data?.issueUpdate;
}

// CLI direct run
if (process.argv[1] && process.argv[1].endsWith("linear-helper.mjs")) {
  const [,, targetId, targetState] = process.argv;
  if (!targetId || !targetState) {
    console.log("Usage: node scripts/linear-helper.mjs <ANI-XXX> <in_progress|done|todo|backlog>");
    process.exit(1);
  }
  updateIssueState(targetId, targetState).then((res) => {
    console.log(`Updated ${targetId} -> ${targetState}:`, res);
  }).catch(err => {
    console.error("Failed to update Linear issue:", err);
    process.exit(1);
  });
}
