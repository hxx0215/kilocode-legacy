// kilocode_change - new file
import type { XaiSuperGrokAccessTokenProvider } from "./token-provider"

const extensionVersion: string = require("../../package.json").version ?? "unknown"

const mergeHeaders = (input: RequestInfo | URL, init: RequestInit | undefined, accessToken: string): Headers => {
	const headers = new Headers(input instanceof Request ? input.headers : undefined)
	if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value))
	headers.set("Authorization", `Bearer ${accessToken}`)
	headers.set("User-Agent", `kilocode/${extensionVersion}`)
	return headers
}

export const createXaiSuperGrokAuthenticatedFetch =
	(tokenProvider: XaiSuperGrokAccessTokenProvider, fetchFn: typeof fetch = fetch): typeof fetch =>
	async (input, init) => {
		const accessToken = await tokenProvider.getAccessToken()
		if (!accessToken) {
			throw new Error(
				"Not authenticated with SuperGrok / X Premium. Sign in with xAI OAuth in provider settings.",
			)
		}

		const request = (token: string) =>
			fetchFn(input, {
				...init,
				headers: mergeHeaders(input, init, token),
			})
		let response = await request(accessToken)
		if (response.status !== 401) return response

		const refreshedToken = await tokenProvider.getAccessToken(true)
		if (!refreshedToken) return response
		response = await request(refreshedToken)
		return response
	}
