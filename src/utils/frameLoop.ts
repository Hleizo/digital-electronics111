type Phase = 'acquire' | 'render'
interface Subscriber { phase: Phase; callback: (timestamp: number) => void }
const subscribers = new Set<Subscriber>()
let pendingFrame: number | null = null

function tick(timestamp: number) {
  pendingFrame = null
  // Settings can re-register a renderer at any time. Acquisition always runs
  // first, so every panel sees the same endpoint regardless of effect order.
  try {
    for (const phase of ['acquire', 'render'] as const) {
      for (const subscriber of [...subscribers]) {
        if (subscriber.phase === phase && subscribers.has(subscriber)) subscriber.callback(timestamp)
      }
    }
  } finally {
    if (subscribers.size && pendingFrame === null) pendingFrame = requestAnimationFrame(tick)
  }
}

export function subscribeFrame(callback: (timestamp: number) => void, phase: Phase = 'render') {
  const subscriber = { callback, phase }
  subscribers.add(subscriber)
  if (pendingFrame === null) pendingFrame = requestAnimationFrame(tick)
  return () => {
    subscribers.delete(subscriber)
    if (!subscribers.size && pendingFrame !== null) { cancelAnimationFrame(pendingFrame); pendingFrame = null }
  }
}
