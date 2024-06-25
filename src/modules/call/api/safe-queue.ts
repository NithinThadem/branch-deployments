import { Mutex } from './mutex'

export class SafeQueue<T> {

	private _mutex = new Mutex()
	private _queue: T[] = []

	public async enqueue(item: T | T[]): Promise<void> {
		const unlock = await this._mutex.lock()
		try {
			if (Array.isArray(item)) {
				this._queue.push(...item)
			} else {
				this._queue.push(item)
			}
		} finally {
			unlock()
		}
	}

	public async dequeue(): Promise<T | undefined> {
		const unlock = await this._mutex.lock()
		try {
			return this._queue.shift()
		} finally {
			unlock()
		}
	}

	public async length(): Promise<number> {
		const unlock = await this._mutex.lock()
		try {
			return this._queue.length
		} finally {
			unlock()
		}
	}

	public async clear(): Promise<void> {
		const unlock = await this._mutex.lock()
		try {
			this._queue = []
		} finally {
			unlock()
		}
	}

	public async isEmpty(): Promise<boolean> {
		const unlock = await this._mutex.lock()
		try {
			return this._queue.length === 0
		} finally {
			unlock()
		}
	}

}
