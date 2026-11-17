/** Fixed-capacity chronological ring buffer of raw (unquantized) analog samples. */
export class SampleBuffer {
  private readonly times: Float64Array
  private readonly voltages: Float64Array
  private head = 0
  size = 0
  readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
    this.times = new Float64Array(capacity)
    this.voltages = new Float64Array(capacity)
  }

  clear() { this.head = 0; this.size = 0 }

  latest() {
    if (!this.size) return null
    const index = (this.head + this.size - 1) % this.capacity
    return { timeSeconds: this.times[index], voltage: this.voltages[index] }
  }

  push(time: number, voltage: number) {
    const index = (this.head + this.size) % this.capacity
    this.times[index] = time
    this.voltages[index] = voltage
    if (this.size < this.capacity) this.size++
    else this.head = (this.head + 1) % this.capacity
  }

  discardBefore(time: number) {
    while (this.size && this.times[this.head] < time) {
      this.head = (this.head + 1) % this.capacity
      this.size--
    }
  }

  forEach(from: number, to: number, visit: (time: number, voltage: number) => void, includePrevious = false) {
    let previous = -1
    for (let i = 0; i < this.size; i++) {
      const index = (this.head + i) % this.capacity
      if (this.times[index] < from) { previous = index; continue }
      if (this.times[index] > to) break
      if (includePrevious && previous !== -1) {
        visit(this.times[previous], this.voltages[previous])
        previous = -1
      }
      visit(this.times[index], this.voltages[index])
    }
    if (includePrevious && previous !== -1 && this.times[previous] <= to) visit(this.times[previous], this.voltages[previous])
  }
}
