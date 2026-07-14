// kilocode_change - new file
import { describe, expect, it, vi } from "vitest"

import { XaiSuperGrokTokenBrokerClient, type XaiSuperGrokTokenRequestMessage } from "../xai-super-grok-token-broker.js"

const TOKEN_BROKER_SYMBOL = Symbol.for("kilocode.xai-super-grok.token-provider")
type InstalledTokenProvider = { getAccessToken(forceRefresh?: boolean): Promise<string | undefined> }

const installedTokenProvider = (): InstalledTokenProvider =>
	(globalThis as typeof globalThis & { [TOKEN_BROKER_SYMBOL]?: InstalledTokenProvider })[TOKEN_BROKER_SYMBOL]!

describe("XaiSuperGrokTokenBrokerClient", () => {
	it("requests a short-lived token without transferring refresh credentials", async () => {
		let sent: XaiSuperGrokTokenRequestMessage | undefined
		const broker = new XaiSuperGrokTokenBrokerClient((message) => {
			sent = message
		})
		broker.install()

		const provider = installedTokenProvider()
		const tokenPromise = provider.getAccessToken(true)
		expect(sent).toMatchObject({ type: "xaiSuperGrokTokenRequest", forceRefresh: true })
		expect(sent).not.toHaveProperty("refreshToken")

		broker.handleResponse({
			type: "xaiSuperGrokTokenResponse",
			requestId: sent!.requestId,
			accessToken: "short-lived-access-token",
		})
		await expect(tokenPromise).resolves.toBe("short-lived-access-token")
		broker.dispose()
	})

	it("propagates parent errors and times out abandoned requests", async () => {
		vi.useFakeTimers()
		try {
			let sent: XaiSuperGrokTokenRequestMessage | undefined
			const broker = new XaiSuperGrokTokenBrokerClient((message) => {
				sent = message
			}, 100)
			broker.install()
			const provider = installedTokenProvider()

			const rejected = provider.getAccessToken()
			broker.handleResponse({
				type: "xaiSuperGrokTokenResponse",
				requestId: sent!.requestId,
				error: "Sign in to SuperGrok first",
			})
			await expect(rejected).rejects.toThrow("Sign in to SuperGrok first")

			const timedOut = provider.getAccessToken()
			vi.advanceTimersByTime(100)
			await expect(timedOut).rejects.toThrow("timed out")
			broker.dispose()
		} finally {
			vi.useRealTimers()
		}
	})
})
