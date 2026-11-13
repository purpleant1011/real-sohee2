import { officialNaverLoginUrl, type NaverConnectionSummary } from './naver-connection'

const capabilityCopy = {
  local_connector: '소희 Chrome 연결기로 게시 가능',
  manual_assist_only: '게시 보조만 가능',
  unsupported: '현재 미지원',
} as const

export function NaverConnectionCard({ summary }: Readonly<{ summary: NaverConnectionSummary }>) {
  return <section aria-labelledby="naver-connection-title">
    <p>CN-02 · CN-03</p>
    <h1 id="naver-connection-title">네이버 채널 연결</h1>
    <p>{summary.accountLabel ?? '연결할 네이버 계정을 선택해 주세요.'}</p>
    <dl>
      <div><dt>네이버 플레이스</dt><dd>{capabilityCopy[summary.placeCapability]}</dd></div>
      <div><dt>네이버 블로그</dt><dd>네이버 블로그 · {capabilityCopy[summary.blogCapability]}</dd></div>
      <div><dt>인증 상태</dt><dd>{summary.reauthRequired ? '사용자 로그인이 필요해요' : '공식 화면에서 마지막 확인이 필요해요'}</dd></div>
    </dl>
    <a href={officialNaverLoginUrl} target="_blank" rel="noreferrer">네이버 공식 로그인 열기</a>
    <p>비밀번호, 인증 번호, 보안 문자는 이 화면에서 입력하거나 저장하지 않아요.</p>
  </section>
}
