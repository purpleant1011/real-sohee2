export const READINESS_LABELS = {
  channels: {
    instagram: '인스타그램',
    threads: '스레드',
  },
  channelItems: {
    connection: '채널 연결',
    loginPersistence: '로그인 유지',
    publishPermission: '게시 권한',
    accountVerification: '계정 확인',
  },
  globalItems: {
    publishFeature: '소희의 실제 게시 기능',
    agentPause: '긴급 정지',
    approvedVaultItems: '승인된 보관 글',
  },
  itemStates: {
    ok: '준비 완료',
    blocked: '확인 필요',
    unknown: '확인 중',
  },
  reasons: {
    loaderError: '지금은 확인하지 못했어요. 잠시 후 다시 확인해 주세요',
    channelNotConnected: '채널이 아직 연결되지 않았어요. 채널을 연결해 주세요',
    channelNotVerified: '채널 연결 인증을 마치지 못했어요. 다시 연결해 주세요',
    tokenExpired: '로그인 유효시간이 지났어요. 채널을 다시 연결해 주세요',
    tokenExpiringSoon: '연결이 곧 끊겨요, 다시 연결해 주세요',
    tokenMissing: '로그인 상태를 확인할 수 없어요. 채널을 다시 연결해 주세요',
    scopeDeficient: '게시 권한이 부족해요. 권한을 허용해 주세요',
    accountUnknown: '연결된 계정 정보를 확인할 수 없어요',
    publishFeatureOff: '소희의 실제 게시 기능이 아직 켜지지 않았어요. 켜지면 알려드릴게요.',
    agentPaused: '긴급 정지가 켜져 있어서 지금은 게시할 수 없어요.',
    noApprovedVaultItems: '발행 가능한 승인된 보관 글이 아직 없어요.',
  },
  actions: {
    connectChannel: { label: '채널 연결하기', href: '/app/system' },
    reconnectChannel: { label: '다시 연결하기', href: '/app/system' },
    grantPermission: { label: '권한 설정하기', href: '/app/system' },
    checkAccount: { label: '계정 확인하기', href: '/app/system' },
    resumeAgent: { label: '다시 시작하기', href: '/app' },
    createContent: { label: '미리보기 스튜디오에서 글 만들기', href: '/app/content' },
  },
  summaries: {
    ready: '첫 게시할 준비가 됐어요 🎉',
    unknown: '일부는 확인하지 못했어요',
    remaining: (count: number) => `첫 게시까지 ${count}가지가 남았어요`,
  },
} as const
