/** 웹·모바일 공통 계정 변경 안내. 실제 계정 선택·권한 승인은 Meta에서 진행한다. */
export function ChannelAccountHelp() {
  return (
    <section aria-label="계정 변경 안내" className="space-y-2 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
      <h2 className="font-semibold">연결 계정을 바꾸고 싶으세요?</h2>
      <p className="leading-relaxed text-muted-foreground">연결을 먼저 해제할 필요는 없어요. 각 채널의 계정 변경 버튼을 누르고 새 계정으로 로그인해 주세요. 새 계정 인증과 저장이 끝나면 이 가게의 연결 계정이 바뀌어요.</p>
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-primary">다른 계정이 안 보이거나 연결이 거부되나요?</summary>
        <ul className="list-disc space-y-2 pl-5 leading-relaxed text-muted-foreground">
          <li>인스타그램은 비즈니스 또는 크리에이터 계정만 연결할 수 있어요. 새 계정의 유형과 게시 권한 허용 여부를 확인해 주세요.</li>
          <li>스레드에 이전 계정만 보이면 같은 브라우저에서 Threads를 열어 원하는 계정으로 전환한 뒤 돌아와 다시 연결해 주세요.</li>
          <li>앱 안에서 열린 브라우저라면 Safari나 Chrome에서 소희에 로그인한 뒤 다시 시도해 주세요. 계정 변경에는 댓글·DM·인사이트 확장 권한이 필요하지 않아요.</li>
          <li>계속 거부되면 오류 화면의 문구를 소희 운영팀에 보내 주세요. 비밀번호나 인증번호는 보내지 마세요.</li>
        </ul>
      </details>
    </section>
  )
}
