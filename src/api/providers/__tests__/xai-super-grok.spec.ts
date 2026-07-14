// kilocode_change - new file
import { createXaiSuperGrokAuthenticatedFetch } from "../../../integrations/xai-super-grok/authenticated-fetch"
import {
	capXaiSuperGrokOutputTokens,
	selectXaiSuperGrokDefaultModel,
	XAI_SUPER_GROK_MAX_OUTPUT_TOKENS,
} from "../xai-super-grok"

const modelInfo = { contextWindow: 100_000, supportsPromptCache: false }

describe("XaiSuperGrokHandler", () => {
	it("selects models in the requested priority order", () => {
		expect(selectXaiSuperGrokDefaultModel({ "grok-4.3": modelInfo, other: modelInfo })).toBe("grok-4.3")
		expect(selectXaiSuperGrokDefaultModel({ other: modelInfo, "grok-code-fast-1": modelInfo })).toBe(
			"grok-code-fast-1",
		)
		expect(selectXaiSuperGrokDefaultModel({ other: modelInfo })).toBe("other")
	})

	it("caps the advertised model output at the newer Kilo 32K safety limit", () => {
		expect(capXaiSuperGrokOutputTokens(500_000)).toBe(XAI_SUPER_GROK_MAX_OUTPUT_TOKENS)
		expect(capXaiSuperGrokOutputTokens(16_384)).toBe(16_384)
		expect(capXaiSuperGrokOutputTokens(undefined)).toBe(XAI_SUPER_GROK_MAX_OUTPUT_TOKENS)
	})

	it("injects OAuth authorization and retries once after a 401", async () => {
		const getAccessToken = vi.fn(async (forceRefresh?: boolean) => (forceRefresh ? "refreshed" : "initial"))
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
			.mockResolvedValueOnce(new Response("ok", { status: 200 }))
		const authenticatedFetch = createXaiSuperGrokAuthenticatedFetch({ getAccessToken }, fetchFn)

		await expect(
			authenticatedFetch("https://api.x.ai/v1/responses", {
				method: "POST",
				headers: { Authorization: "Bearer xai-oauth", "X-Test": "value" },
				body: "{}",
			}),
		).resolves.toHaveProperty("status", 200)
		expect(getAccessToken).toHaveBeenNthCalledWith(1)
		expect(getAccessToken).toHaveBeenNthCalledWith(2, true)
		expect(fetchFn).toHaveBeenCalledTimes(2)
		expect(new Headers(fetchFn.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer initial")
		expect(new Headers(fetchFn.mock.calls[1][1]?.headers).get("authorization")).toBe("Bearer refreshed")
	})

	it("fails clearly when no OAuth account is connected", async () => {
		const authenticatedFetch = createXaiSuperGrokAuthenticatedFetch(
			{ getAccessToken: async () => undefined },
			vi.fn<typeof fetch>(),
		)

		await expect(authenticatedFetch("https://api.x.ai/v1/responses")).rejects.toThrow(
			"Not authenticated with SuperGrok / X Premium",
		)
	})
})
