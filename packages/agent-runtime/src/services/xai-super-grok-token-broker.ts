// kilocode_change - new file
const TOKEN_BROKER_SYMBOL = Symbol.for("kilocode.xai-super-grok.token-provider")

export interface XaiSuperGrokTokenRequestMessage {
	type: "xaiSuperGrokTokenRequest"
	requestId: string
	forceRefresh: boolean
}

export interface XaiSuperGrokTokenResponseMessage {
	type: "xaiSuperGrokTokenResponse"
	requestId: string
	accessToken?: string
	error?: string
}

type PendingRequest = {
	resolve: (accessToken: string | undefined) => void
	reject: (error: Error) => void
	timeout: NodeJS.Timeout
}

type GlobalWithTokenBroker = typeof globalThis & {
	[TOKEN_BROKER_SYMBOL]?: { getAccessToken(forceRefresh?: boolean): Promise<string | undefined> }
}

export class XaiSuperGrokTokenBrokerClient {
	private nextRequestId = 0
	private readonly pending = new Map<string, PendingRequest>()

	constructor(
		private readonly send: (message: XaiSuperGrokTokenRequestMessage) => void,
		private readonly timeoutMs = 15_000,
	) {}

	install(): void {
		;(globalThis as GlobalWithTokenBroker)[TOKEN_BROKER_SYMBOL] = {
			getAccessToken: (forceRefresh = false) => this.requestAccessToken(forceRefresh),
		}
	}

	handleResponse(message: XaiSuperGrokTokenResponseMessage): boolean {
		if (message.type !== "xaiSuperGrokTokenResponse") return false
		const pending = this.pending.get(message.requestId)
		if (!pending) return true

		clearTimeout(pending.timeout)
		this.pending.delete(message.requestId)
		if (message.error) pending.reject(new Error(message.error))
		else pending.resolve(message.accessToken)
		return true
	}

	dispose(): void {
		const global = globalThis as GlobalWithTokenBroker
		delete global[TOKEN_BROKER_SYMBOL]
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout)
			pending.reject(new Error("SuperGrok token broker disposed"))
		}
		this.pending.clear()
	}

	private requestAccessToken(forceRefresh: boolean): Promise<string | undefined> {
		const requestId = `xai-token-${process.pid}-${++this.nextRequestId}`
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(requestId)
				reject(new Error("SuperGrok access-token request timed out"))
			}, this.timeoutMs)
			this.pending.set(requestId, { resolve, reject, timeout })
			try {
				this.send({ type: "xaiSuperGrokTokenRequest", requestId, forceRefresh })
			} catch (error) {
				clearTimeout(timeout)
				this.pending.delete(requestId)
				reject(error instanceof Error ? error : new Error(String(error)))
			}
		})
	}
}
