// kilocode_change - new file
import { xaiSuperGrokOAuthManager } from "./oauth"

export interface XaiSuperGrokAccessTokenProvider {
	getAccessToken(forceRefresh?: boolean): Promise<string | undefined>
}

let accessTokenProvider: XaiSuperGrokAccessTokenProvider = xaiSuperGrokOAuthManager

const AGENT_TOKEN_BROKER_SYMBOL = Symbol.for("kilocode.xai-super-grok.token-provider")

type GlobalWithTokenBroker = typeof globalThis & {
	[AGENT_TOKEN_BROKER_SYMBOL]?: XaiSuperGrokAccessTokenProvider
}

export const setXaiSuperGrokAccessTokenProvider = (provider: XaiSuperGrokAccessTokenProvider): void => {
	accessTokenProvider = provider
}

export const resetXaiSuperGrokAccessTokenProvider = (): void => {
	accessTokenProvider = xaiSuperGrokOAuthManager
}

export const getXaiSuperGrokAccessToken = (forceRefresh = false): Promise<string | undefined> => {
	const agentTokenBroker = (globalThis as GlobalWithTokenBroker)[AGENT_TOKEN_BROKER_SYMBOL]
	return (agentTokenBroker ?? accessTokenProvider).getAccessToken(forceRefresh)
}
