// Linear Live Sync Helper for Sohee Admin V0.2
const apiKey = process.env.LINEAR_API_KEY;

export const LINEAR_STATES = {
  BACKLOG: "01d738da-ef4b-42de-b6d6-ad7be76c75dc",
  TODO: "744022e9-9015-442e-a82a-d914c17d1646",
  IN_PROGRESS: "5454c65b-bd8a-4df3-bf7a-452ce057061b",
  IN_REVIEW: "bac8578e-af11-45b0-9ff8-9935c25e678e",
  DONE: "1ba18dd4-0aec-422d-94b3-1bf984bc658a"
};

export const EPIC_IDS = {
  A: { id: "0d66f83b-ef78-44bf-9eae-875126c8737a", key: "ANI-323", title: "[EPIC A] 현행 관리자 감사·MFA 접근 복구" },
  B: { id: "43c11e72-1ef3-4a5f-954f-b652933a6fb0", key: "ANI-324", title: "[EPIC B] shadcn 관리자 플랫폼·IA·공통 컴포넌트" },
  C: { id: "4c29d991-6fa9-4381-abd4-d58a0063747c", key: "ANI-325", title: "[EPIC C] 고객·회원·Workspace 360·Lifecycle" },
  D: { id: "3dc75a5f-747b-409e-b31d-ab165f011400", key: "ANI-326", title: "[EPIC D] AI Agent Runtime·Mission·ActionRun 운영" },
  E: { id: "49aa315a-668a-49e0-90f4-94557b1d021b", key: "ANI-327", title: "[EPIC E] 콘텐츠·승인·4채널 게시·검증·복구" },
  F: { id: "723ee591-74b0-4e1a-bc7b-f92ecb239c80", key: "ANI-328", title: "[EPIC F] 채널 Capability·CRM·예약·고객 전환" },
  G: { id: "1b3bf4bf-03b6-447d-9440-83f2da85a4f8", key: "ANI-329", title: "[EPIC G] 매출·구독·결제·환불·크레딧 원장" },
  H: { id: "39b4e4f7-49a5-4d17-a3f5-c2deb37f259d", key: "ANI-330", title: "[EPIC H] AI Usage·Token·Provider Cost·FinOps" },
  I: { id: "3d7ea1f2-f2ea-449e-a99b-4ed716221ee1", key: "ANI-331", title: "[EPIC I] 고객지원·Support Session·운영도구" },
  J: { id: "3b28a90f-0b6e-47ec-925b-cc2ffb215553", key: "ANI-332", title: "[EPIC J] 시스템·Queue·Webhook·Provider·Incident·Release" },
  K: { id: "9ec40dc5-c97c-4993-a6b9-a63aa844bf9e", key: "ANI-333", title: "[EPIC K] 관리자 보안·MFA·RBAC·승인·Immutable Audit" },
  L: { id: "1573bdc9-e04a-4b6d-a7a4-f267b0eaaafc", key: "ANI-334", title: "[EPIC L] Feature Flag·Model·Prompt·Policy Runtime Control" },
  M: { id: "3a3516a0-49c5-49e8-89aa-cc438cc7286e", key: "ANI-335", title: "[EPIC M] Admin Data Model·API/RPC·Event Contracts" }
};

export async function linearQuery(query, variables = {}) {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": apiKey },
    body: JSON.stringify({ query, variables })
  });
  return await res.json();
}

export async function syncEpicState(epicKey, stateId, comment) {
  const epic = Object.values(EPIC_IDS).find(e => e.key === epicKey);
  if (!epic) return console.error("Unknown epic key:", epicKey);

  const res = await linearQuery(`
    mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue { id identifier title state { name } }
      }
    }
  `, { id: epic.id, input: { stateId } });

  console.log(`[Linear Sync] ${epic.key} -> ${res.data?.issueUpdate?.issue?.state?.name}`);

  if (comment) {
    await linearQuery(`
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
        }
      }
    `, { input: { issueId: epic.id, body: comment } });
    console.log(`[Linear Comment] Added comment to ${epic.key}`);
  }
}
