export class Mutex {

	private mutex = Promise.resolve()

	lock(): Promise<() => void> {
		let begin: (unlock: () => void) => void = () => { /* no-op */ }
		this.mutex = this.mutex.then(() => new Promise(begin))
		return new Promise(res => { begin = res })
	}

}
