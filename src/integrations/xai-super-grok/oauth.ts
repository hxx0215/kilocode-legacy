// kilocode_change - new file
import * as http from "http"
import { createHash, randomBytes } from "crypto"
import type { ExtensionContext } from "vscode"

const extensionVersion: string = require("../../package.json").version ?? "unknown"

export const XAI_SUPER_GROK_OAUTH_CONFIG = {
	clientId: "b1a00492-073a-47ea-816f-4c329264a828",
	authorizeUrl: "https://auth.x.ai/oauth2/authorize",
	tokenUrl: "https://auth.x.ai/oauth2/token",
	deviceAuthorizationUrl: "https://auth.x.ai/oauth2/device/code",
	scope: "openid profile email offline_access grok-cli:access api:access",
	callbackHost: "127.0.0.1",
	callbackPort: 56_121,
	callbackPath: "/callback",
} as const

const REDIRECT_URI = `http://${XAI_SUPER_GROK_OAUTH_CONFIG.callbackHost}:${XAI_SUPER_GROK_OAUTH_CONFIG.callbackPort}${XAI_SUPER_GROK_OAUTH_CONFIG.callbackPath}`
const CREDENTIALS_KEY = "xai-super-grok.oauth.credentials"
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
const REFRESH_SKEW_MS = 120_000
const DEFAULT_TOKEN_LIFETIME_MS = 60 * 60 * 1000
const DEFAULT_DEVICE_EXPIRES_MS = 5 * 60 * 1000
const DEFAULT_DEVICE_INTERVAL_MS = 5_000
const MIN_DEVICE_INTERVAL_MS = 1_000
const SLOW_DOWN_INCREMENT_MS = 5_000
const CORS_ALLOWED_ORIGINS = new Set(["https://accounts.x.ai", "https://auth.x.ai"])

export interface XaiSuperGrokCredentials {
	accessToken: string
	refreshToken: string
	expiresAt: number
	email?: string
}

interface TokenResponse {
	access_token: string
	refresh_token?: string
	id_token?: string
	expires_in?: number
}

export interface DeviceCodeResponse {
	device_code: string
	user_code: string
	verification_uri: string
	verification_uri_complete?: string
	expires_in?: number
	interval?: number
}

export interface DeviceAuthorizationInfo {
	userCode: string
	verificationUri: string
	verificationUriComplete?: string
	expiresAt: number
}

export interface XaiSuperGrokOAuthOptions {
	fetch?: typeof fetch
	authorizeUrl?: string
	tokenUrl?: string
	deviceAuthorizationUrl?: string
	now?: () => number
	sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

type SecretStorage = Pick<ExtensionContext["secrets"], "get" | "store" | "delete">

const base64Url = (value: Buffer): string => value.toString("base64url")
const generateRandomValue = (bytes = 32): string => base64Url(randomBytes(bytes))

const generatePkce = (): { verifier: string; challenge: string } => {
	const verifier = generateRandomValue(48)
	return { verifier, challenge: base64Url(createHash("sha256").update(verifier).digest()) }
}

const authHeaders = (): Record<string, string> => ({
	"Content-Type": "application/x-www-form-urlencoded",
	Accept: "application/json",
	"User-Agent": `kilocode/${extensionVersion}`,
})

const decodeJwtClaims = (token?: string): Record<string, unknown> | undefined => {
	if (!token) return undefined
	const payload = token.split(".")[1]
	if (!payload) return undefined
	try {
		return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>
	} catch (error) {
		console.debug("[xai-super-grok-oauth] Could not decode JWT claims:", error)
		return undefined
	}
}

const tokenExpiresAt = (tokens: TokenResponse, now: number): number => {
	const jwtExpiry = decodeJwtClaims(tokens.access_token)?.exp
	if (typeof jwtExpiry === "number") return jwtExpiry * 1000
	return now + (tokens.expires_in ? tokens.expires_in * 1000 : DEFAULT_TOKEN_LIFETIME_MS)
}

const toCredentials = (tokens: TokenResponse, previousRefreshToken: string | undefined, now: number) => {
	if (!tokens.access_token) throw new Error("xAI token response is missing access_token")
	const refreshToken = tokens.refresh_token || previousRefreshToken
	if (!refreshToken) throw new Error("xAI token response is missing refresh_token")
	const email = decodeJwtClaims(tokens.id_token)?.email
	return {
		accessToken: tokens.access_token,
		refreshToken,
		expiresAt: tokenExpiresAt(tokens, now),
		...(typeof email === "string" ? { email } : {}),
	} satisfies XaiSuperGrokCredentials
}

const readErrorBody = async (
	response: Response,
): Promise<{ error?: string; error_description?: string; raw: string }> => {
	const raw = await response.text().catch((error) => {
		console.debug("[xai-super-grok-oauth] Could not read OAuth error response:", error)
		return ""
	})
	try {
		const parsed = JSON.parse(raw) as { error?: string; error_description?: string }
		return { ...parsed, raw }
	} catch (error) {
		if (raw) console.debug("[xai-super-grok-oauth] OAuth error response was not JSON:", error)
		return { raw }
	}
}

export class XaiSuperGrokOAuthTokenError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly oauthError?: string,
		readonly description?: string,
	) {
		super(message)
	}

	isInvalidRefreshGrant(): boolean {
		return (
			(this.status === 400 || this.status === 401) &&
			(this.oauthError === "invalid_grant" || /invalid|expired|revoked/i.test(this.description ?? ""))
		)
	}
}

export const buildXaiSuperGrokAuthorizeUrl = ({
	challenge,
	state,
	nonce,
	authorizeUrl = XAI_SUPER_GROK_OAUTH_CONFIG.authorizeUrl,
}: {
	challenge: string
	state: string
	nonce: string
	authorizeUrl?: string
}): string => {
	const query = new URLSearchParams({
		response_type: "code",
		client_id: XAI_SUPER_GROK_OAUTH_CONFIG.clientId,
		redirect_uri: REDIRECT_URI,
		scope: XAI_SUPER_GROK_OAUTH_CONFIG.scope,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state,
		nonce,
		plan: "generic",
		referrer: "kilocode",
	})
	return `${authorizeUrl}?${query.toString()}`
}

const defaultSleep = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
	new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Device authorization cancelled"))
			return
		}
		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort)
			resolve()
		}, milliseconds)
		const onAbort = () => {
			clearTimeout(timeout)
			reject(new Error("Device authorization cancelled"))
		}
		signal?.addEventListener("abort", onAbort, { once: true })
	})

const positiveSecondsToMs = (value: unknown, fallback: number): number => {
	const seconds = Number(value)
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallback
}

const requestTokens = async ({
	body,
	fetchFn,
	tokenUrl,
	operation,
}: {
	body: URLSearchParams
	fetchFn: typeof fetch
	tokenUrl: string
	operation: string
}): Promise<TokenResponse> => {
	const response = await fetchFn(tokenUrl, { method: "POST", headers: authHeaders(), body: body.toString() })
	if (!response.ok) {
		const detail = await readErrorBody(response)
		throw new XaiSuperGrokOAuthTokenError(
			`${operation} failed (${response.status})${detail.error_description || detail.error || detail.raw ? `: ${detail.error_description || detail.error || detail.raw}` : ""}`,
			response.status,
			detail.error,
			detail.error_description,
		)
	}
	return (await response.json()) as TokenResponse
}

export const pollXaiSuperGrokDeviceCode = async (
	device: DeviceCodeResponse,
	options: XaiSuperGrokOAuthOptions & { signal?: AbortSignal } = {},
): Promise<TokenResponse> => {
	const fetchFn = options.fetch ?? fetch
	const now = options.now ?? Date.now
	const sleep = options.sleep ?? defaultSleep
	const deadline = now() + positiveSecondsToMs(device.expires_in, DEFAULT_DEVICE_EXPIRES_MS)
	let interval = Math.max(positiveSecondsToMs(device.interval, DEFAULT_DEVICE_INTERVAL_MS), MIN_DEVICE_INTERVAL_MS)

	while (now() < deadline) {
		if (options.signal?.aborted) throw new Error("Device authorization cancelled")
		const response = await fetchFn(options.tokenUrl ?? XAI_SUPER_GROK_OAUTH_CONFIG.tokenUrl, {
			method: "POST",
			headers: authHeaders(),
			body: new URLSearchParams({
				grant_type: DEVICE_CODE_GRANT_TYPE,
				client_id: XAI_SUPER_GROK_OAUTH_CONFIG.clientId,
				device_code: device.device_code,
			}).toString(),
			signal: options.signal,
		})
		if (response.ok) return (await response.json()) as TokenResponse

		const detail = await readErrorBody(response)
		if (detail.error === "authorization_pending") {
			await sleep(Math.min(interval, Math.max(0, deadline - now())), options.signal)
			continue
		}
		if (detail.error === "slow_down") {
			interval += SLOW_DOWN_INCREMENT_MS
			await sleep(Math.min(interval, Math.max(0, deadline - now())), options.signal)
			continue
		}
		if (detail.error === "access_denied" || detail.error === "authorization_denied") {
			throw new Error("xAI device authorization was denied")
		}
		if (detail.error === "expired_token") throw new Error("xAI device code expired")
		throw new Error(
			`xAI device token exchange failed (${response.status})${detail.error_description || detail.error || detail.raw ? `: ${detail.error_description || detail.error || detail.raw}` : ""}`,
		)
	}
	throw new Error("xAI device authorization timed out")
}

const escapeHtml = (value: string): string =>
	value.replace(
		/[&<>"']/g,
		(character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
	)

const callbackHtml = (success: boolean, error?: string): string =>
	`<!doctype html><html><head><meta charset="utf-8"><title>xAI OAuth</title></head><body style="font-family:system-ui;background:#131010;color:#f1ecec;display:grid;place-items:center;height:100vh"><main style="text-align:center"><h1>${success ? "Authorization Successful" : "Authorization Failed"}</h1><p>${success ? "You can close this window and return to Kilo Code." : escapeHtml(error ?? "Unknown error")}</p></main>${success ? "<script>setTimeout(() => window.close(), 2000)</script>" : ""}</body></html>`

export const applyXaiSuperGrokCallbackCors = (
	request: Pick<http.IncomingMessage, "headers">,
	response: Pick<http.ServerResponse, "setHeader">,
): boolean => {
	const origin = request.headers.origin
	if (typeof origin !== "string" || !CORS_ALLOWED_ORIGINS.has(origin)) return false

	response.setHeader("Access-Control-Allow-Origin", origin)
	response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
	response.setHeader("Access-Control-Allow-Headers", "Content-Type")
	response.setHeader("Access-Control-Allow-Private-Network", "true")
	response.setHeader("Vary", "Origin")
	return true
}

export class XaiSuperGrokOAuthManager {
	private secrets?: SecretStorage
	private credentials?: XaiSuperGrokCredentials
	private refreshPromise?: Promise<XaiSuperGrokCredentials>
	private browserServer?: http.Server
	private browserReject?: (error: Error) => void
	private deviceController?: AbortController
	private readonly options: XaiSuperGrokOAuthOptions
	private logFn: (message: string) => void = console.log

	constructor(options: XaiSuperGrokOAuthOptions = {}) {
		this.options = options
	}

	initialize(context: Pick<ExtensionContext, "secrets">, logFn?: (message: string) => void): void {
		this.secrets = context.secrets
		if (logFn) this.logFn = logFn
	}

	async loadCredentials(): Promise<XaiSuperGrokCredentials | undefined> {
		if (this.credentials) return this.credentials
		const stored = await this.secrets?.get(CREDENTIALS_KEY)
		if (!stored) return undefined
		try {
			const parsed = JSON.parse(stored) as Partial<XaiSuperGrokCredentials>
			if (!parsed.accessToken || !parsed.refreshToken || typeof parsed.expiresAt !== "number") {
				throw new Error("Stored xAI OAuth credentials are incomplete")
			}
			this.credentials = parsed as XaiSuperGrokCredentials
			return this.credentials
		} catch (error) {
			this.logFn(`[xai-super-grok-oauth] Failed to load credentials: ${String(error)}`)
			return undefined
		}
	}

	async saveCredentials(credentials: XaiSuperGrokCredentials): Promise<void> {
		if (!this.secrets) throw new Error("xAI SuperGrok OAuth manager is not initialized")
		await this.secrets.store(CREDENTIALS_KEY, JSON.stringify(credentials))
		this.credentials = credentials
	}

	async clearCredentials(): Promise<void> {
		await this.secrets?.delete(CREDENTIALS_KEY)
		this.credentials = undefined
	}

	async isAuthenticated(): Promise<boolean> {
		return (await this.getAccessToken()) !== undefined
	}

	async getEmail(): Promise<string | undefined> {
		return (await this.loadCredentials())?.email
	}

	async getAccessToken(forceRefresh = false): Promise<string | undefined> {
		const credentials = await this.loadCredentials()
		if (!credentials) return undefined
		const now = (this.options.now ?? Date.now)()
		if (!forceRefresh && credentials.expiresAt > now + REFRESH_SKEW_MS) return credentials.accessToken

		if (!this.refreshPromise) {
			this.refreshPromise = this.refresh(credentials).finally(() => {
				this.refreshPromise = undefined
			})
		}
		try {
			return (await this.refreshPromise).accessToken
		} catch (error) {
			this.logFn(`[xai-super-grok-oauth] Token refresh failed: ${String(error)}`)
			if (error instanceof XaiSuperGrokOAuthTokenError && error.isInvalidRefreshGrant()) {
				await this.clearCredentials()
			}
			return undefined
		}
	}

	forceRefreshAccessToken(): Promise<string | undefined> {
		return this.getAccessToken(true)
	}

	private async refresh(credentials: XaiSuperGrokCredentials): Promise<XaiSuperGrokCredentials> {
		const tokens = await requestTokens({
			fetchFn: this.options.fetch ?? fetch,
			tokenUrl: this.options.tokenUrl ?? XAI_SUPER_GROK_OAUTH_CONFIG.tokenUrl,
			operation: "xAI token refresh",
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: credentials.refreshToken,
				client_id: XAI_SUPER_GROK_OAUTH_CONFIG.clientId,
			}),
		})
		const refreshed = toCredentials(tokens, credentials.refreshToken, (this.options.now ?? Date.now)())
		await this.saveCredentials({ ...credentials, ...refreshed })
		return this.credentials!
	}

	async startBrowserAuthorization(): Promise<{
		authorizationUrl: string
		completion: Promise<XaiSuperGrokCredentials>
	}> {
		this.cancelBrowserAuthorization()
		const pkce = generatePkce()
		const state = generateRandomValue()
		const nonce = generateRandomValue()

		let resolveCompletion!: (credentials: XaiSuperGrokCredentials) => void
		let rejectCompletion!: (error: Error) => void
		const completion = new Promise<XaiSuperGrokCredentials>((resolve, reject) => {
			resolveCompletion = resolve
			rejectCompletion = reject
		})
		this.browserReject = rejectCompletion

		const server = http.createServer(async (request, response) => {
			const url = new URL(request.url ?? "/", REDIRECT_URI)
			applyXaiSuperGrokCallbackCors(request, response)

			// Chromium requires a successful Private Network Access preflight before
			// xAI's authorization page can deliver the code to the loopback callback.
			if (request.method === "OPTIONS") {
				response.writeHead(204).end()
				return
			}

			if (url.pathname !== XAI_SUPER_GROK_OAUTH_CONFIG.callbackPath) {
				response.writeHead(404).end("Not found")
				return
			}
			const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
			const code = url.searchParams.get("code")
			if (error || !code || url.searchParams.get("state") !== state) {
				const message = error || (!code ? "Missing authorization code" : "Invalid OAuth state")
				response
					.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
					.end(callbackHtml(false, message))
				rejectCompletion(new Error(message))
				this.stopBrowserServer()
				return
			}

			try {
				const tokens = await requestTokens({
					fetchFn: this.options.fetch ?? fetch,
					tokenUrl: this.options.tokenUrl ?? XAI_SUPER_GROK_OAUTH_CONFIG.tokenUrl,
					operation: "xAI token exchange",
					body: new URLSearchParams({
						grant_type: "authorization_code",
						code,
						redirect_uri: REDIRECT_URI,
						client_id: XAI_SUPER_GROK_OAUTH_CONFIG.clientId,
						code_verifier: pkce.verifier,
					}),
				})
				const returnedNonce = decodeJwtClaims(tokens.id_token)?.nonce
				if (typeof returnedNonce === "string" && returnedNonce !== nonce) {
					throw new Error("Invalid OAuth nonce")
				}
				const credentials = toCredentials(tokens, undefined, (this.options.now ?? Date.now)())
				await this.saveCredentials(credentials)
				response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(callbackHtml(true))
				resolveCompletion(credentials)
			} catch (exchangeError) {
				const message = exchangeError instanceof Error ? exchangeError.message : String(exchangeError)
				response
					.writeHead(500, { "Content-Type": "text/html; charset=utf-8" })
					.end(callbackHtml(false, message))
				rejectCompletion(exchangeError instanceof Error ? exchangeError : new Error(message))
			} finally {
				this.stopBrowserServer()
			}
		})

		await new Promise<void>((resolve, reject) => {
			const onError = (error: NodeJS.ErrnoException) => {
				server.removeListener("listening", onListening)
				const message =
					error.code === "EADDRINUSE"
						? `Port ${XAI_SUPER_GROK_OAUTH_CONFIG.callbackPort} is already in use. Use the Remote / VPS device-code sign-in button instead.`
						: error.message
				const failure = new Error(message)
				rejectCompletion(failure)
				reject(failure)
			}
			const onListening = () => {
				server.removeListener("error", onError)
				resolve()
			}
			server.once("error", onError)
			server.once("listening", onListening)
			server.listen(XAI_SUPER_GROK_OAUTH_CONFIG.callbackPort, XAI_SUPER_GROK_OAUTH_CONFIG.callbackHost)
		})
		this.browserServer = server

		const timeout = setTimeout(
			() => {
				rejectCompletion(new Error("xAI browser authorization timed out"))
				this.stopBrowserServer()
			},
			5 * 60 * 1000,
		)
		void completion
			.finally(() => clearTimeout(timeout))
			.catch((error) => {
				this.logFn(`[xai-super-grok-oauth] Browser authorization ended: ${String(error)}`)
			})

		return {
			authorizationUrl: buildXaiSuperGrokAuthorizeUrl({
				challenge: pkce.challenge,
				state,
				nonce,
				authorizeUrl: this.options.authorizeUrl,
			}),
			completion,
		}
	}

	cancelBrowserAuthorization(): void {
		this.browserReject?.(new Error("xAI browser authorization cancelled"))
		this.stopBrowserServer()
	}

	private stopBrowserServer(): void {
		this.browserReject = undefined
		this.browserServer?.close((error) => {
			if (error) this.logFn(`[xai-super-grok-oauth] Callback server close failed: ${error.message}`)
		})
		this.browserServer = undefined
	}

	async startDeviceAuthorization(): Promise<{
		info: DeviceAuthorizationInfo
		completion: Promise<XaiSuperGrokCredentials>
	}> {
		this.cancelDeviceAuthorization()
		const fetchFn = this.options.fetch ?? fetch
		const response = await fetchFn(
			this.options.deviceAuthorizationUrl ?? XAI_SUPER_GROK_OAUTH_CONFIG.deviceAuthorizationUrl,
			{
				method: "POST",
				headers: authHeaders(),
				body: new URLSearchParams({
					client_id: XAI_SUPER_GROK_OAUTH_CONFIG.clientId,
					scope: XAI_SUPER_GROK_OAUTH_CONFIG.scope,
				}).toString(),
			},
		)
		if (!response.ok) {
			const detail = await readErrorBody(response)
			throw new Error(
				`xAI device code request failed (${response.status}): ${detail.error_description || detail.error || detail.raw}`,
			)
		}
		const device = (await response.json()) as DeviceCodeResponse
		if (!device.device_code || !device.user_code || !device.verification_uri) {
			throw new Error("xAI device code response is incomplete")
		}

		const controller = new AbortController()
		this.deviceController = controller
		const now = (this.options.now ?? Date.now)()
		const completion = pollXaiSuperGrokDeviceCode(device, { ...this.options, signal: controller.signal })
			.then(async (tokens) => {
				const credentials = toCredentials(tokens, undefined, (this.options.now ?? Date.now)())
				await this.saveCredentials(credentials)
				return credentials
			})
			.finally(() => {
				if (this.deviceController === controller) this.deviceController = undefined
			})

		return {
			info: {
				userCode: device.user_code,
				verificationUri: device.verification_uri,
				verificationUriComplete: device.verification_uri_complete,
				expiresAt: now + positiveSecondsToMs(device.expires_in, DEFAULT_DEVICE_EXPIRES_MS),
			},
			completion,
		}
	}

	cancelDeviceAuthorization(): void {
		this.deviceController?.abort()
		this.deviceController = undefined
	}
}

export const xaiSuperGrokOAuthManager = new XaiSuperGrokOAuthManager()
