// kilocode_change - new file
import { convertModelsDevXaiCatalog, getXaiSuperGrokModels } from "../xai-super-grok"

const textModel = {
	id: "grok-test",
	name: "Grok Test",
	description: "test model",
	tool_call: true,
	reasoning: true,
	reasoning_options: [{ type: "effort", values: ["none", "low", "high"] }],
	temperature: true,
	modalities: { input: ["text", "image", "pdf"], output: ["text"] },
	limit: { context: 1_000_000, output: 30_000 },
	cost: {
		input: 1.25,
		output: 2.5,
		cache_read: 0.2,
		context_over_200k: { input: 2.5, output: 5, cache_read: 0.4 },
	},
}

describe("xAI SuperGrok models.dev fetcher", () => {
	it("converts text models and limits attachments to the supported image capability", () => {
		const models = convertModelsDevXaiCatalog({
			xai: {
				models: {
					"grok-test": textModel,
					"image-only": {
						id: "image-only",
						modalities: { input: ["text"], output: ["image"] },
						limit: { context: 8_000, output: 0 },
					},
				},
			},
		})

		expect(Object.keys(models)).toEqual(["grok-test"])
		expect(models["grok-test"]).toMatchObject({
			displayName: "Grok Test",
			contextWindow: 1_000_000,
			maxTokens: 30_000,
			supportsImages: true,
			supportsNativeTools: true,
			supportsReasoningEffort: ["none", "low", "high"],
			longContextPricing: {
				thresholdTokens: 200_000,
				inputPriceMultiplier: 2,
				outputPriceMultiplier: 2,
				cacheReadsPriceMultiplier: 2,
			},
		})
	})

	it("retries transient failures twice", async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("busy", { status: 503 }))
			.mockResolvedValueOnce(new Response("slow", { status: 429 }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ xai: { models: { "grok-test": textModel } } }), { status: 200 }),
			)

		await expect(getXaiSuperGrokModels(fetchFn)).resolves.toHaveProperty("grok-test")
		expect(fetchFn).toHaveBeenCalledTimes(3)
	})

	it("does not retry a permanent client failure", async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad request", { status: 400 }))

		await expect(getXaiSuperGrokModels(fetchFn)).rejects.toThrow("models.dev request failed (400)")
		expect(fetchFn).toHaveBeenCalledTimes(1)
	})
})
