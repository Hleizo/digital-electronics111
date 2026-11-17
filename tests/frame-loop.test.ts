import assert from 'node:assert/strict'
import { test } from 'node:test'
import { subscribeFrame } from '../src/utils/frameLoop.ts'

test('one shared frame advances acquisition before every renderer, even after settings re-register a panel', () => {
  const oldRequest = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
  const oldCancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
  let id = 0, time = 0
  const pending = new Map<number, (time: number) => void>()
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (callback: (time: number) => void) => { pending.set(++id, callback); return id } })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: (frame: number) => pending.delete(frame) })
  const cleanups: (() => void)[] = []
  try {
    const seen: number[] = []
    cleanups.push(subscribeFrame(() => seen.push(time)))
    cleanups.push(subscribeFrame(timestamp => { time = timestamp }, 'acquire'))
    let removeDac = subscribeFrame(() => seen.push(time))
    cleanups.push(() => removeDac())
    assert.equal(pending.size, 1)
    const fire = (timestamp: number) => { const [key, callback] = [...pending][0]; pending.delete(key); callback(timestamp) }
    fire(10)
    assert.deepEqual(seen, [10, 10])
    removeDac()
    removeDac = subscribeFrame(() => seen.push(time))
    fire(20)
    assert.deepEqual(seen, [10, 10, 20, 20])
    assert.equal(pending.size, 1)
    cleanups.forEach(cleanup => cleanup())
    assert.equal(pending.size, 0)
  } finally {
    cleanups.forEach(cleanup => cleanup())
    if (oldRequest) Object.defineProperty(globalThis, 'requestAnimationFrame', oldRequest); else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    if (oldCancel) Object.defineProperty(globalThis, 'cancelAnimationFrame', oldCancel); else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  }
})
