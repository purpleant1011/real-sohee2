/** 읽기 GET만 허용한다. 헤더와 본문 해석을 합쳐 제한하고, abort를 무시하는 전송도 기다리지 않는다. */
export async function boundedMobileRead<T>(
  url: string,
  consume: (response: Response) => Promise<T>,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel = () => {}
  const stopped = new Promise<never>((_, reject) => {
    cancel = () => {
      reject(new Error('조회 취소'))
      controller.abort()
    }
    if (signal.aborted) { cancel(); return }
    signal.addEventListener('abort', cancel, { once: true })
    timer = setTimeout(() => {
      reject(new Error('조회 시간 초과'))
      controller.abort()
    }, 15_000)
  })
  try {
    return await Promise.race([
      stopped,
      (async () => {
        if (signal.aborted) throw new Error('조회 취소')
        const response = await fetcher(url, { cache: 'no-store', signal: controller.signal })
        return consume(response)
      })(),
    ])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
  }
}
