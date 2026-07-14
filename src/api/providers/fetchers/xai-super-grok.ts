// kilocode_change - new file
import type { ModelInfo, ModelRecord, ReasoningEffortExtended } from "@roo-code/types"

const MODELS_DEV_URL = "https://models.dev/api.json"
const REQUEST_TIMEOUT_MS = 10_000
const MAX_RETRIES = 2

interface ModelsDevModel {
	id?: string
	name?: string
	description?: string
	tool_call?: boolean
	reasoning?: boolean
	reasoning_options?: Array<{ type?: string; values?: string[] }>
	temperature?: boolean
	modalities?: { input?: string[]; output?: string[] }
	limit?: { context?: number; output?: number }
	cost?: {
		input?: number
		output?: number
		cache_read?: number
		cache_write?: number
		context_over_200k?: { input?: number; output?: number; cache_read?: number; cache_write?: number }
	}
}

interface ModelsDevResponse {
	xai?: { models?: Record<string, ModelsDevModel> }
}

const isTransientStatus = (status: number): boolean => status === 408 || status === 429 || status >= 500

class ModelsDevHttpError extends Error {
	constructor(
		status: number,
		readonly transient: boolean,
	) {
		super(`models.dev request failed (${status})`)
	}
}

const toReasoningEfforts = (model: ModelsDevModel): ReasoningEffortExtended[] | undefined => {
	if (!model.reasoning) return undefined

	const supported = new Set(["none", "minimal", "low", "medium", "high", "xhigh"])
	const values = model.reasoning_options
		?.find((option) => option.type === "effort")
		?.values?.filter((value): value is ReasoningEffortExtended => supported.has(value))

	return values?.length ? values : ["low", "medium", "high"]
}

const priceMultiplier = (base: number | undefined, extended: number | undefined): number | undefined =>
	base && extended ? extended / base : undefined

export const convertModelsDevXaiModel = (model: ModelsDevModel): ModelInfo | undefined => {
	const inputModalities = model.modalities?.input ?? []
	const outputModalities = model.modalities?.output ?? []
	const contextWindow = model.limit?.context

	if (!inputModalities.includes("text") || !outputModalities.includes("text") || !contextWindow) {
		return undefined
	}

	const reasoningEfforts = toReasoningEfforts(model)
	const extendedPrice = model.cost?.context_over_200k
	const supportsNativeTools = model.tool_call === true

	return {
		displayName: model.name,
		description: model.description,
		contextWindow,
		maxTokens: model.limit?.output || undefined,
		supportsImages: inputModalities.includes("image"),
		supportsPromptCache: model.cost?.cache_read !== undefined,
		supportsNativeTools,
		...(supportsNativeTools
			? {
					defaultToolProtocol: "native" as const,
					includedTools: ["search_replace"],
					excludedTools: ["apply_diff"],
				}
			: {}),
		supportsReasoningEffort: reasoningEfforts,
		supportsTemperature: model.temperature,
		inputPrice: model.cost?.input,
		outputPrice: model.cost?.output,
		cacheReadsPrice: model.cost?.cache_read,
		cacheWritesPrice: model.cost?.cache_write,
		...(extendedPrice
			? {
					longContextPricing: {
						thresholdTokens: 200_000,
						inputPriceMultiplier: priceMultiplier(model.cost?.input, extendedPrice.input),
						outputPriceMultiplier: priceMultiplier(model.cost?.output, extendedPrice.output),
						cacheReadsPriceMultiplier: priceMultiplier(model.cost?.cache_read, extendedPrice.cache_read),
						cacheWritesPriceMultiplier: priceMultiplier(model.cost?.cache_write, extendedPrice.cache_write),
					},
				}
			: {}),
	}
}

export const convertModelsDevXaiCatalog = (payload: ModelsDevResponse): ModelRecord =>
	Object.fromEntries(
		Object.entries(payload.xai?.models ?? {}).flatMap(([catalogId, model]) => {
			const converted = convertModelsDevXaiModel(model)
			return converted ? [[model.id || catalogId, converted]] : []
		}),
	)

const fetchCatalog = async (fetchFn: typeof fetch): Promise<ModelsDevResponse> => {
	let lastError: unknown

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
		try {
			const response = await fetchFn(MODELS_DEV_URL, {
				headers: { Accept: "application/json" },
				signal: controller.signal,
			})
			if (!response.ok) {
				const error = new ModelsDevHttpError(response.status, isTransientStatus(response.status))
				if (!error.transient || attempt === MAX_RETRIES) throw error
				lastError = error
				continue
			}
			return (await response.json()) as ModelsDevResponse
		} catch (error) {
			lastError = error
			if ((error instanceof ModelsDevHttpError && !error.transient) || attempt === MAX_RETRIES) throw error
		} finally {
			clearTimeout(timeout)
		}
	}

	throw lastError instanceof Error ? lastError : new Error("models.dev request failed")
}

export const getXaiSuperGrokModels = async (fetchFn: typeof fetch = fetch): Promise<ModelRecord> => {
	const models = convertModelsDevXaiCatalog(await fetchCatalog(fetchFn))
	if (Object.keys(models).length === 0) throw new Error("models.dev returned no usable xAI text models")
	return models
}
