export type Verification = Readonly<{
  status: string
  verified: boolean
  username?: string | null
  accountId?: string | null
  scopes?: string[] | null
}>

export type CredentialSummary = Readonly<{
  status: string
  account_label?: string | null
  external_account_id?: string | null
}>

type ChannelDisplay = Readonly<{
  label: string
  action: '연결하기' | '다시 연결' | null
  kind: 'connected' | 'disconnected' | 'reauth' | 'unknown'
  badgeLabel?: string
}>

export function getChannelDisplay(
  verification: Verification | null | undefined,
  credential: CredentialSummary | null | undefined,
): ChannelDisplay {
  if (!verification || verification.status === 'UNKNOWN' || verification.status === 'BLOCKED') {
    return { label: '상태를 확인할 수 없어요', action: null, kind: 'unknown' }
  }
  const isIdentityMissing =
    verification.status === 'CONNECTION_IDENTITY_MISSING' ||
    (Boolean(credential) &&
      ['connected', 'verified', 'authorized'].includes(credential?.status?.toLowerCase() ?? '') &&
      credential?.external_account_id === null)

  if (isIdentityMissing) {
    return { label: '다시 연결 필요', action: '다시 연결', kind: 'reauth', badgeLabel: '재연결 필요' }
  }
  if (verification.status === 'READY_DEGRADED' || verification.status === 'SCOPE_INSUFFICIENT' ||
      credential?.status?.toLowerCase() === 'reauth_required' || credential?.status?.toLowerCase() === 'reverify_required') {
    return { label: '다시 연결 필요', action: '다시 연결', kind: 'reauth' }
  }
  if (verification.status === 'NOT_CONNECTED') {
    return { label: '연결 필요', action: '연결하기', kind: 'disconnected' }
  }
  if (verification.status === 'VERIFIED' || verification.status === 'CONNECTED_UNVERIFIED') {
    const raw = verification.username || credential?.account_label
    const handle = raw?.trim().replace(/^@+/u, '')
    return { label: handle ? `연결됨 @${handle}` : '연결됨', action: null, kind: 'connected' }
  }
  return { label: '상태를 확인할 수 없어요', action: null, kind: 'unknown' }
}

export type ConnectNoticeAction = Readonly<{
  label: string
  href: string
}>

export type ConnectNotice = Readonly<{
  title: string
  message: string
  kind: 'info' | 'error' | 'success'
  action?: ConnectNoticeAction | null
}>

export function getConnectNotice(
  result: string | null | undefined,
  safeCode: string | null | undefined,
  options?: {
    channel?: string | null
    returnPath?: string | null
  },
): ConnectNotice | null {
  const code = safeCode || result
  const channel = options?.channel?.toLowerCase()
  const returnPath = options?.returnPath || '/app/channels'
  const targetChannel = channel === 'threads' ? 'threads' : channel === 'instagram' ? 'instagram' : null
  const connectHref = targetChannel
    ? `/api/channels/${targetChannel}/connect?returnPath=${encodeURIComponent(returnPath)}`
    : returnPath

  if (code === 'SCOPE_MISSING') {
    return {
      title: '게시 권한을 허용해 주세요',
      message: '소희가 사장님 대신 글을 올리려면 "게시물 작성" 권한이 필요해요. 다시 연결하면서 게시 권한을 허용해 주세요.',
      kind: 'error',
      action: targetChannel ? {
        label: '다시 연결하기',
        href: connectHref,
      } : null,
    }
  }

  if (code === 'SCOPE_VERIFICATION_UNAVAILABLE') {
    return {
      title: '권한을 확인하지 못했어요',
      message: '잠시 후 다시 시도해 주세요.',
      kind: 'error',
      action: targetChannel ? {
        label: '다시 연결하기',
        href: connectHref,
      } : null,
    }
  }

  if (code === 'ACCOUNT_ALREADY_CONNECTED') {
    return {
      title: '이미 다른 소희 계정에 연결된 계정이에요',
      message: '이 인스타그램/스레드 계정은 다른 소희 계정에서 사용 중이에요. 원래 사용하던 소희 계정으로 로그인하거나, 다른 계정으로 연결해 주세요. 도움이 필요하면 소희 운영팀에 문의해 주세요.',
      kind: 'error',
      action: targetChannel ? {
        label: '다른 계정으로 연결하기',
        href: connectHref,
      } : null,
    }
  }

  switch (result) {
    case 'forbidden':
      return { title: '계정 연결 권한이 없어요', message: '매장 대표 또는 관리자만 채널을 연결할 수 있어요. 권한이 필요하다면 매장 대표에게 요청해 주세요.', kind: 'error' }
    case 'cancelled':
      return { title: '새 연결을 완료하지 못했어요', message: '이번 연결은 취소되었거나 Meta에서 허용하지 않았어요. 기존 연결은 변경하지 않았어요. 원하시면 새 계정으로 다시 연결해 주세요.', kind: 'info', action: targetChannel ? { label: '다시 연결하기', href: connectHref } : null }
    case 'invalid':
      return { title: '연결 시간이 지났어요', message: '연결 요청이 만료되었거나 올바르지 않아요. 아래에서 다시 연결해 주세요.', kind: 'error' }
    case 'unavailable':
      if (safeCode === 'META_OAUTH_TOKEN_EXCHANGE') {
        return { title: '계정 연결을 완료하지 못했어요', message: targetChannel === 'instagram' ? 'Meta 계정 인증을 완료하지 못했어요. 연결하려는 인스타그램이 비즈니스 또는 크리에이터 계정인지 확인하고 새 계정으로 다시 로그인해 주세요. 계속 실패하면 소희 운영팀에 문의해 주세요.' : 'Meta 계정 인증을 완료하지 못했어요. 같은 브라우저에서 원하는 계정으로 전환한 뒤 다시 연결해 주세요. 계속 실패하면 소희 운영팀에 문의해 주세요.', kind: 'error', action: targetChannel ? { label: '다시 연결하기', href: connectHref } : null }
      }
      if (safeCode === 'META_OAUTH_ACCOUNT_LOOKUP') {
        return { title: '계정 정보를 확인하지 못했어요', message: '로그인한 계정 정보를 확인하고 연결 권한을 확인해 주세요. 계속 실패하면 소희 운영팀에 문의해 주세요.', kind: 'error' }
      }
      if (safeCode === 'META_OAUTH_PERSISTENCE' || safeCode === 'CONNECTION_SAVE_FAILED') {
        return { title: '연결 정보를 저장하지 못했어요', message: '잠시 후 다시 시도해 주세요. 계속 실패하면 소희 운영팀에 문의해 주세요.', kind: 'error' }
      }
      return { title: '지금은 연결할 수 없어요', message: '잠시 후 다시 시도해 주세요. 계속 실패하면 소희 운영팀에 문의해 주세요.', kind: 'error' }
    case 'connected':
    case 'authorized':
      return { title: '연결 결과를 확인하고 있어요', message: '실제 연결 상태를 확인한 뒤 아래 카드에 표시할게요. 연결되지 않았다면 잠시 후 새로고침해 주세요.', kind: 'info' }
    case 'CONNECTION_SAVE_FAILED':
      return { title: '연결 정보를 저장하지 못했어요', message: '잠시 후 다시 시도해 주세요. 계속 실패하면 소희 운영팀에 문의해 주세요.', kind: 'error' }
    default:
      if (safeCode === 'CONNECTION_SAVE_FAILED') {
        return { title: '연결 정보를 저장하지 못했어요', message: '잠시 후 다시 시도해 주세요. 계속 실패하면 소희 운영팀에 문의해 주세요.', kind: 'error' }
      }
      return null
  }
}
