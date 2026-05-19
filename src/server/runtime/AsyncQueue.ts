/**
 * Bounded-buffer async queue: producers `push()` from any sync context,
 * consumers iterate it as an AsyncIterable. Backs the streaming-input
 * channel that lets the orchestrator feed `query()` with new user
 * messages over the lifetime of a Session.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = []
  private resolvers: Array<(value: IteratorResult<T>) => void> = []
  private closed = false

  push(item: T): void {
    if (this.closed) throw new Error('AsyncQueue is closed')
    const next = this.resolvers.shift()
    if (next) {
      next({ value: item, done: false })
    } else {
      this.buffer.push(item)
    }
  }

  close(): void {
    this.closed = true
    while (this.resolvers.length > 0) {
      this.resolvers.shift()!({ value: undefined as never, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false })
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as never, done: true })
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve)
        })
      },
      return: (): Promise<IteratorResult<T>> => {
        this.close()
        return Promise.resolve({ value: undefined as never, done: true })
      },
    }
  }
}
