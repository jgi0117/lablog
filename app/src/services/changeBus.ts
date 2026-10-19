export interface ChangeMessage {
  table: 'projects' | 'experiments' | 'steps' | 'dataItems'
  id: string
  /** 보낸 탭의 식별자. 자기 탭의 변경은 무시하는 데 쓴다. */
  from: string
}

export interface ChangeBus {
  post(msg: Omit<ChangeMessage, 'from'>): void
  /** 다른 탭에서 온 변경만 전달한다. 해제 함수를 돌려준다. */
  subscribe(fn: (msg: ChangeMessage) => void): () => void
  close(): void
}

type ChannelLike = Pick<BroadcastChannel, 'postMessage' | 'close' | 'addEventListener' | 'removeEventListener'>

/**
 * 같은 브라우저의 다른 탭에 "데이터가 바뀌었다"를 알린다(BroadcastChannel).
 * 지원하지 않는 브라우저에서는 아무 일도 하지 않는다. 충돌은 저장할 때 version 비교로도 잡으므로 이 알림은 보조다.
 */
export function createChangeBus(name: string, factory?: (name: string) => ChannelLike): ChangeBus {
  const me = Math.random().toString(36).slice(2)
  let channel: ChannelLike | null = null
  try {
    channel = factory ? factory(name) : typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null
  } catch {
    channel = null
  }
  return {
    post(msg) {
      try {
        channel?.postMessage({ ...msg, from: me } satisfies ChangeMessage)
      } catch {
        // 닫힌 채널 등은 무시한다.
      }
    },
    subscribe(fn) {
      if (!channel) return () => {}
      const ch = channel
      const handler = (e: Event) => {
        const data = (e as MessageEvent<ChangeMessage>).data
        if (data && data.from !== me) fn(data)
      }
      ch.addEventListener('message', handler)
      return () => ch.removeEventListener('message', handler)
    },
    close() {
      try {
        channel?.close()
      } catch {
        // 무시
      }
      channel = null
    },
  }
}
