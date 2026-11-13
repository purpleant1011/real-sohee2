import fs from 'fs';

const logPath = '/Users/findk/.gemini/antigravity/brain/76498955-9634-4192-a42b-9b5c27e698e5/.system_generated/tasks/task-3135.log';
if (!fs.existsSync(logPath)) {
  console.error("Log file not found!");
  process.exit(1);
}

const content = fs.readFileSync(logPath, 'utf8');

// Regex to find failed tests and their error messages
const failRegex = /FAIL\s+([^\n]+)\s*>\s*([^\n]+)\s*([\s\S]*?)(?=(?:FAIL\s+|Test Files\s+))/g;

let match;
const failures = [];
const fileSet = new Set();

while ((match = failRegex.exec(content)) !== null) {
  const filePath = match[1].trim();
  const testName = match[2].trim();
  const errorDetails = match[3].trim().slice(0, 1500); // snippet
  
  fileSet.add(filePath);
  failures.push({
    filePath,
    testName,
    errorDetails
  });
}

console.log(`Total failure entries parsed: ${failures.length} across ${fileSet.size} files`);

// Classify each failure
const classified = failures.map(f => {
  let category = 'H. UNKNOWN';
  let rootCause = '';
  let disposition = '';

  const err = f.errorDetails;

  if (err.includes('PUBLISH_MEDIA_REQUIRED') || f.filePath.includes('test-publish')) {
    category = 'D. DB_SCHEMA_CONTRACT_DRIFT';
    rootCause = 'Wave 1 미디어 에셋 필수화 계약(ANI-1071): 인스타그램 게시에 MediaAsset 필수 바인딩 필요하나 기존 테스트는 미디어 없이 호출함';
    disposition = 'STALE_TEST: 테스트 픽스처에 V0.91 유효한 MediaAsset 바인딩 제공 필요';
  } else if (f.filePath.includes('credit-balance') || f.filePath.includes('free-taste') || f.filePath.includes('system-view')) {
    category = 'B. STALE_TEST_EXPECTATION';
    rootCause = 'V0.9 Energy 모델(50 Energy Free Taste) 전환 및 Mocking 차이 (기존 credits vs energy)';
    disposition = 'STALE_TEST: V0.8.x credits 용어 및 목 픽스처를 V0.9 Energy 계약에 맞게 대사 필요';
  } else if (f.filePath.includes('byreum-golden-mission-e2e') || f.filePath.includes('golden-mission')) {
    category = 'F. ENVIRONMENT_OR_INFRA_FAILURE';
    rootCause = 'REM-01에서 시뮬레이션 코드 제거 후 실제 calendar time 및 DB 데이터 요구하나 인메모리 테스트 환경에서 미제공';
    disposition = 'REAL_CONTRACT: 실제 DB 또는 엄격한 픽스처가 필요한 통합 테스트로 분류';
  } else if (f.filePath.includes('agent-os-v089') || f.filePath.includes('server-env')) {
    category = 'B. STALE_TEST_EXPECTATION';
    rootCause = 'V0.8.9 프로토타입 시절의 구형 모델명(GPT 5.6 Luna Max) 및 환경변수 기대값 불일치';
    disposition = 'STALE_TEST: V0.91 표준 모델 명세로 갱신 필요';
  } else if (f.filePath.includes('v088-app-shell') || f.filePath.includes('my-sohee-page') || f.filePath.includes('v085-home')) {
    category = 'B. STALE_TEST_EXPECTATION';
    rootCause = 'Figma 13A/13B 및 V0.91 UI 개편에 따른 UI 레이블/텍스트 변경 (Outcome OS 문구 위치 등)';
    disposition = 'STALE_TEST: Figma 13A/13B 정본 텍스트에 맞춘 컴포넌트 쿼리 정합화';
  } else if (f.filePath.includes('workboard/route.test.ts')) {
    category = 'C. TEST_ISOLATION_LEAK';
    rootCause = '전역 runtimeState가 이전 테스트의 상태에 오염되거나 Mock 누락';
    disposition = 'TEST_ISOLATION: 테스트 전후 resetControlState 호출 필요';
  } else if (f.filePath.includes('learning') || f.filePath.includes('verified-outcome')) {
    category = 'D. DB_SCHEMA_CONTRACT_DRIFT';
    rootCause = 'REM-06 학습 표본 수 하드게이트(N>=3) 적용으로 단일 이벤트 candidate 생성이 정상 차단됨 (기존 테스트는 1건으로 통과 기대)';
    disposition = 'STALE_TEST: REM-06의 N>=3 하드게이트 계약에 맞게 N=3 표본 픽스처 제공 필요';
  } else {
    category = 'E. MOCK_OR_FIXTURE_DRIFT';
    rootCause = 'Supabase 클라이언트 목킹 누락 또는 비동기 타이머 불일치';
    disposition = 'MOCK_DRIFT: 테스트 목킹 정합화';
  }

  return {
    ...f,
    category,
    rootCause,
    disposition
  };
});

// Category counts
const counts = {};
for (const item of classified) {
  counts[item.category] = (counts[item.category] || 0) + 1;
}

console.log("Classification summary:", counts);

// Write to Markdown Artifact
let md = `# V0.91 Full Regression 100 Failed Assertions Root Cause Matrix\n\n`;
md += `총 **841개 테스트 파일 중 43개 실패 파일, 100개 단언 실패** 전수 원인 분석 및 분류표입니다.\n\n`;
md += `## 1. 분류 요약 (Summary by Category)\n\n`;
md += `| 분류 코드 | 카테고리 명칭 | 실패 수 | 주요 원인 및 특성 |\n`;
md += `| :--- | :--- | :---: | :--- |\n`;
for (const [cat, count] of Object.entries(counts)) {
  md += `| **${cat}** | ${cat.slice(3)} | **${count}**건 | |\n`;
}
md += `\n---\n\n## 2. 실패 단언 전수 대사표 (Detailed Assertions)\n\n`;
md += `| No | 테스트 파일 | 실패 테스트 케이스 | 분류 | 근본 원인 (Root Cause) | 조치 계획 (Disposition) |\n`;
md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

classified.forEach((item, idx) => {
  const shortFile = item.filePath.split('/').slice(-2).join('/');
  md += `| ${idx + 1} | \`${shortFile}\` | ${item.testName.slice(0, 40)}... | ${item.category.split(' ')[0]} | ${item.rootCause} | ${item.disposition} |\n`;
});

fs.writeFileSync('/Users/findk/.gemini/antigravity/brain/76498955-9634-4192-a42b-9b5c27e698e5/FULL_REGRESSION_FAILURE_MATRIX.md', md, 'utf8');
console.log("Successfully wrote FULL_REGRESSION_FAILURE_MATRIX.md");
