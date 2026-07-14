// kilocode_change - new file
import { createXai } from "@ai-sdk/xai"
import type { LanguageModel } from "ai"

import { type ModelInfo, type ModelRecord, xaiSuperGrokDefaultModelId, xaiSuperGrokModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { getXaiSuperGrokAccessToken } from "../../integrations/xai-super-grok/token-provider"
import { createXaiSuperGrokAuthenticatedFetch } from "../../integrations/xai-super-grok/authenticated-fetch"
import { getModelsFromCache } from "./fetchers/modelCache"
import { getModelParams } from "../transform/model-params"
import { OpenAICompatibleHandler } from "./openai-compatible"
import type { ApiHandlerCreateMessageMetadata } from "../index"

const OAUTH_DUMMY_KEY = "xai-oauth"
export const XAI_SUPER_GROK_MAX_OUTPUT_TOKENS = 32_000

export const capXaiSuperGrokOutputTokens = (requested: number | null | undefined): number =>
	Math.min(requested || XAI_SUPER_GROK_MAX_OUTPUT_TOKENS, XAI_SUPER_GROK_MAX_OUTPUT_TOKENS)

export const selectXaiSuperGrokDefaultModel = (models: ModelRecord): string =>
	models[xaiSuperGrokDefaultModelId]
		? xaiSuperGrokDefaultModelId
		: models["grok-4.3"]
			? "grok-4.3"
			: Object.keys(models)[0] || xaiSuperGrokDefaultModelId

const getAvailableModels = (): ModelRecord => getModelsFromCache("xai-super-grok") ?? { ...xaiSuperGrokModels }

export class XaiSuperGrokHandler extends OpenAICompatibleHandler {
	private readonly xaiProvider: ReturnType<typeof createXai>

	constructor(options: ApiHandlerOptions) {
		const models = getAvailableModels()
		const modelId =
			options.apiModelId && models[options.apiModelId]
				? options.apiModelId
				: selectXaiSuperGrokDefaultModel(models)
		const modelInfo = models[modelId] ?? xaiSuperGrokModels[xaiSuperGrokDefaultModelId]
		super(options, {
			providerName: "xai-super-grok",
			baseURL: "https://api.x.ai/v1",
			apiKey: OAUTH_DUMMY_KEY,
			modelId,
			modelInfo,
			modelMaxTokens: options.modelMaxTokens,
			temperature: options.modelTemperature ?? undefined,
		})
		this.xaiProvider = createXai({
			apiKey: OAUTH_DUMMY_KEY,
			fetch: createXaiSuperGrokAuthenticatedFetch({ getAccessToken: getXaiSuperGrokAccessToken }),
		})
	}

	protected override getLanguageModel(): LanguageModel {
		return this.xaiProvider.responses(this.getModel().id)
	}

	override getModel(): { id: string; info: ModelInfo; maxTokens?: number; temperature?: number } {
		const models = getAvailableModels()
		const id =
			this.options.apiModelId && models[this.options.apiModelId]
				? this.options.apiModelId
				: selectXaiSuperGrokDefaultModel(models)
		const info = models[id] ?? xaiSuperGrokModels[xaiSuperGrokDefaultModelId]
		const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options })
		return { id, info, ...params }
	}

	protected override getMaxOutputTokens(): number | undefined {
		const model = this.getModel()
		return capXaiSuperGrokOutputTokens(this.options.modelMaxTokens ?? model.maxTokens ?? model.info.maxTokens)
	}

	protected override getRequestTemperature(model: { temperature?: number }): number | undefined {
		return this.getModel().info.supportsTemperature === false ? undefined : model.temperature
	}

	protected override getProviderOptions(
		model: { id: string; info: ModelInfo },
		metadata?: ApiHandlerCreateMessageMetadata,
	) {
		const effort = this.options.reasoningEffort
		const reasoningEffort =
			effort === "xhigh"
				? "high"
				: effort === "low" || effort === "medium" || effort === "high"
					? effort
					: undefined

		return {
			xai: {
				store: metadata?.store ?? false,
				...(model.info.supportsReasoningEffort && reasoningEffort ? { reasoningEffort } : {}),
			},
		}
	}
}
