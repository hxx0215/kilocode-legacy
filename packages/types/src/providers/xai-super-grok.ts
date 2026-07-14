// kilocode_change - new file
import type { ModelInfo } from "../model.js"

export type XaiSuperGrokModelId = keyof typeof xaiSuperGrokModels

export const xaiSuperGrokDefaultModelId: XaiSuperGrokModelId = "grok-code-fast-1"

/**
 * Bundled fallback used before the models.dev catalog has been downloaded.
 * The live catalog is authoritative and is refreshed independently at runtime.
 */
export const xaiSuperGrokModels = {
	"grok-code-fast-1": {
		maxTokens: 16_384,
		contextWindow: 256_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.2,
		outputPrice: 1.5,
		cacheReadsPrice: 0.02,
		description: "xAI's fast coding model, available through SuperGrok and X Premium OAuth.",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
	},
	"grok-4.3": {
		maxTokens: 30_000,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		supportsReasoningEffort: ["none", "low", "medium", "high"],
		supportsTemperature: true,
		inputPrice: 1.25,
		outputPrice: 2.5,
		cacheReadsPrice: 0.2,
		description: "xAI's Grok 4.3 model for chat, coding, and agentic tool use.",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
	},
} as const satisfies Record<string, ModelInfo>
