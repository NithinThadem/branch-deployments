/* eslint-disable require-yield */

export function teeAsyncGenerator<T>(source: AsyncGenerator<T>, numberOfTees: number): AsyncGenerator<T>[] {
	const buffers: T[][] = Array.from({ length: numberOfTees }, () => [])
	let waiting: [(value: IteratorResult<T>) => void, (reason?: any) => void][] = []

	const pull = async (buffer: T[]) => {
		if (buffer.length > 0) {
			return { value: buffer.shift(), done: false }
		} else {
			return new Promise<IteratorResult<T>>((resolve, reject) => {
				waiting.push([resolve, reject])
			})
		}
	};

	(async () => {
		try {
			for await (const item of source) {
				const currentWaiting = waiting
				waiting = []
				for (const wait of currentWaiting) {
					wait[0]({ value: item, done: false })
				}
				for (const buffer of buffers) {
					buffer.push(item)
				}
			}
			for (const wait of waiting) {
				wait[0]({ value: undefined, done: true })
			}
			waiting = []
		} catch (e) {
			for (const wait of waiting) {
				wait[1](e)
			}
			waiting = []
		}
	})()

	return Array.from({ length: numberOfTees }, (_, index) => (
		(async function* (): AsyncGenerator<T> {
			while (true) {
				const result = await pull(buffers[index])
				if (result.done) { return }
				yield result.value
			}
		})()
	))
}
