export const FIRST_VALUE_IMAGE_NOTICE = '사진을 만드는 중 문제가 생겨 글만 먼저 준비했어요. 글은 그대로 확인하고 보관할 수 있어요.'

/** Only image failure is recoverable. Text generation and durable writes still fail closed. */
export async function continueWithTextIfImageFails<TCopy, TImage>(copies: Promise<TCopy>, image: Promise<TImage>): Promise<{
  copies: TCopy; image: TImage | null; imageNotice: string | null
}> {
  const [text, picture] = await Promise.all([copies, image.then(value => ({ ok: true as const, value }), () => ({ ok: false as const }))])
  return { copies: text, image: picture.ok ? picture.value : null, imageNotice: picture.ok ? null : FIRST_VALUE_IMAGE_NOTICE }
}
