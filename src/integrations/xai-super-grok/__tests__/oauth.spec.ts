// kilocode_change - new file
import {
	applyXaiSuperGrokCallbackCors,
	buildXaiSuperGrokAuthorizeUrl,
	pollXaiSuperGrokDeviceCode,
	XaiSuperGrokOAuthManager,
} from "../oauth"

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

describe("xAI SuperGrok OAuth", () => {
	it("allows xAI callback origins through browser Private Network Access", () => {
		const setHeader = vi.fn()
		const allowed = applyXaiSuperGrokCallbackCors({ headers: { origin: "https://accounts.x.ai" } }, {
			setHeader,
		} as never)

		expect(allowed).toBe(true)
		expect(setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "https://accounts.x.ai")
		expect(setHeader).toHaveBeenCalledWith("Access-Control-Allow-Private-Network", "true")
	})

	it("does not grant callback CORS access to unrelated origins", () => {
		const setHeader = vi.fn()
		const allowed = applyXaiSuperGrokCallbackCors({ headers: { origin: "https://example.com" } }, {
			setHeader,
		} as never)

		expect(allowed).toBe(false)
		expect(setHeader).not.toHaveBeenCalled()
	})

	it("builds the registered PKCE authorization URL", () => {
		const url = new URL(
			buildXaiSuperGrokAuthorizeUrl({
				challenge: "challenge",
				state: "state",
				nonce: "nonce",
			}),
		)

		expect(url.origin + url.pathname).toBe("https://auth.x.ai/oauth2/authorize")
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			client_id: "b1a00492-073a-47ea-816f-4c329264a828",
			redirect_uri: "http://127.0.0.1:56121/callback",
			code_challenge: "challenge",
			code_challenge_method: "S256",
			state: "state",
			nonce: "nonce",
			plan: "generic",
			referrer: "kilocode",
		})
	})

	it("handles authorization_pending and slow_down before succeeding", async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }, 400))
			.mockResolvedValueOnce(jsonResponse({ error: "slow_down" }, 400))
			.mockResolvedValueOnce(jsonResponse({ access_token: "access", refresh_token: "refresh" }))
		const sleeps: number[] = []
		let now = 0

		await expect(
			pollXaiSuperGrokDeviceCode(
				{
					device_code: "device",
					user_code: "USER",
					verification_uri: "https://x.ai/device",
					expires_in: 60,
					interval: 1,
				},
				{
					fetch: fetchFn,
					now: () => now,
					sleep: async (milliseconds) => {
						sleeps.push(milliseconds)
						now += milliseconds
					},
				},
			),
		).resolves.toMatchObject({ access_token: "access", refresh_token: "refresh" })
		expect(sleeps).toEqual([1_000, 6_000])
	})

	it.each([
		["access_denied", "denied"],
		["authorization_denied", "denied"],
		["expired_token", "expired"],
	])("treats %s as terminal", async (oauthError, expectedMessage) => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: oauthError }, 400))

		await expect(
			pollXaiSuperGrokDeviceCode(
				{
					device_code: "device",
					user_code: "USER",
					verification_uri: "https://x.ai/device",
				},
				{ fetch: fetchFn },
			),
		).rejects.toThrow(expectedMessage)
		expect(fetchFn).toHaveBeenCalledTimes(1)
	})

	it("single-flights refreshes and persists a rotated refresh token", async () => {
		const values = new Map<string, string>()
		const secrets = {
			get: vi.fn(async (key: string) => values.get(key)),
			store: vi.fn(async (key: string, value: string) => void values.set(key, value)),
			delete: vi.fn(async (key: string) => void values.delete(key)),
		}
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				jsonResponse({ access_token: "new-access", refresh_token: "rotated-refresh", expires_in: 3600 }),
			)
		const manager = new XaiSuperGrokOAuthManager({ fetch: fetchFn, now: () => 10_000 })
		manager.initialize({ secrets } as never)
		await manager.saveCredentials({ accessToken: "old-access", refreshToken: "old-refresh", expiresAt: 0 })

		await expect(Promise.all([manager.getAccessToken(), manager.getAccessToken()])).resolves.toEqual([
			"new-access",
			"new-access",
		])
		expect(fetchFn).toHaveBeenCalledTimes(1)
		expect(JSON.parse([...values.values()][0])).toMatchObject({
			accessToken: "new-access",
			refreshToken: "rotated-refresh",
		})
	})

	it("clears credentials only for an invalid refresh grant", async () => {
		const createManager = async (body: unknown, status: number) => {
			const values = new Map<string, string>()
			const secrets = {
				get: vi.fn(async (key: string) => values.get(key)),
				store: vi.fn(async (key: string, value: string) => void values.set(key, value)),
				delete: vi.fn(async (key: string) => void values.delete(key)),
			}
			const manager = new XaiSuperGrokOAuthManager({
				fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body, status)),
				now: () => 10_000,
			})
			manager.initialize({ secrets } as never)
			await manager.saveCredentials({ accessToken: "old", refreshToken: "refresh", expiresAt: 0 })
			return { manager, secrets }
		}

		const invalid = await createManager({ error: "invalid_grant", error_description: "revoked" }, 400)
		await expect(invalid.manager.getAccessToken()).resolves.toBeUndefined()
		expect(invalid.secrets.delete).toHaveBeenCalledTimes(1)

		const transient = await createManager({ error: "server_error" }, 500)
		await expect(transient.manager.getAccessToken()).resolves.toBeUndefined()
		expect(transient.secrets.delete).not.toHaveBeenCalled()
	})
})
