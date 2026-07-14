// kilocode_change - new file
import React, { useEffect, useMemo, useState } from "react"
import { Copy, LoaderCircle, RefreshCw } from "lucide-react"

import {
	type ExtensionMessage,
	type ModelRecord,
	type ProviderSettings,
	xaiSuperGrokDefaultModelId,
	xaiSuperGrokModels,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { copyToClipboard } from "@src/utils/clipboard"
import { vscode } from "@src/utils/vscode"
import { Button } from "@src/components/ui"

import { ModelPicker } from "../ModelPicker"

type AuthPhase = "idle" | "browser-waiting" | "device-waiting" | "authenticated" | "error"

interface AuthStatus {
	phase: AuthPhase
	authorizationUrl?: string
	verificationUri?: string
	verificationUriComplete?: string
	userCode?: string
	error?: string
}

interface XaiSuperGrokProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	models?: ModelRecord
	isAuthenticated?: boolean
	email?: string
	simplifySettings?: boolean
}

const selectDefaultModel = (models: ModelRecord): string =>
	models[xaiSuperGrokDefaultModelId]
		? xaiSuperGrokDefaultModelId
		: models["grok-4.3"]
			? "grok-4.3"
			: Object.keys(models)[0] || xaiSuperGrokDefaultModelId

export const XaiSuperGrok: React.FC<XaiSuperGrokProps> = ({
	apiConfiguration,
	setApiConfigurationField,
	models: initialModels,
	isAuthenticated = false,
	email,
	simplifySettings,
}) => {
	const { t } = useAppTranslation()
	const [status, setStatus] = useState<AuthStatus>({ phase: "idle" })
	const [models, setModels] = useState<ModelRecord>(initialModels ?? xaiSuperGrokModels)
	const [refreshing, setRefreshing] = useState(false)

	useEffect(() => {
		if (initialModels && Object.keys(initialModels).length) setModels(initialModels)
	}, [initialModels])

	useEffect(() => {
		const handler = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data
			if (message.type === "xaiSuperGrokAuthStatus") {
				setStatus(message.values as AuthStatus)
			}
			if (message.type === "routerModels" && message.values?.provider === "xai-super-grok") {
				const refreshedModels = message.routerModels?.["xai-super-grok"]
				if (refreshedModels && Object.keys(refreshedModels).length) setModels(refreshedModels)
				setRefreshing(false)
			}
		}
		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	const waiting = status.phase === "browser-waiting" || status.phase === "device-waiting"
	const defaultModelId = useMemo(() => selectDefaultModel(models), [models])
	const verificationUrl = status.verificationUriComplete ?? status.verificationUri

	const refreshModels = () => {
		setRefreshing(true)
		vscode.postMessage({ type: "requestRouterModels", values: { provider: "xai-super-grok", refresh: true } })
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="rounded border border-vscode-panel-border p-3 flex flex-col gap-3">
				<div>
					<div className="font-medium">{t("settings:providers.xaiSuperGrok.title")}</div>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.xaiSuperGrok.description")}
					</div>
				</div>

				{isAuthenticated ? (
					<div className="flex items-center justify-between gap-3">
						<div className="text-sm">
							<div className="font-medium text-vscode-testing-iconPassed">
								{t("settings:providers.xaiSuperGrok.connected")}
							</div>
							{email && <div className="text-vscode-descriptionForeground">{email}</div>}
						</div>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => vscode.postMessage({ type: "xaiSuperGrokSignOut" })}>
							{t("settings:providers.xaiSuperGrok.signOut")}
						</Button>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						<div className="flex flex-wrap gap-2">
							<Button
								variant="primary"
								disabled={waiting}
								onClick={() => vscode.postMessage({ type: "xaiSuperGrokBrowserSignIn" })}>
								{t("settings:providers.xaiSuperGrok.browserSignIn")}
							</Button>
							<Button
								variant="secondary"
								disabled={waiting}
								onClick={() => vscode.postMessage({ type: "xaiSuperGrokDeviceSignIn" })}>
								{t("settings:providers.xaiSuperGrok.deviceSignIn")}
							</Button>
						</div>
						<div className="text-xs text-vscode-descriptionForeground">
							{t("settings:providers.xaiSuperGrok.signInHint")}
						</div>
					</div>
				)}

				{status.phase === "browser-waiting" && status.authorizationUrl && (
					<div className="rounded bg-vscode-textBlockQuote-background p-3 flex flex-col gap-2">
						<div className="flex items-center gap-2 text-sm">
							<LoaderCircle className="size-4 animate-spin" />
							{t("settings:providers.xaiSuperGrok.browserWaiting")}
						</div>
						<div className="break-all text-xs select-text">{status.authorizationUrl}</div>
						<div className="flex gap-2">
							<Button
								size="sm"
								variant="secondary"
								onClick={() => void copyToClipboard(status.authorizationUrl!)}>
								<Copy className="size-3.5" /> {t("settings:providers.xaiSuperGrok.copyLink")}
							</Button>
							<Button
								size="sm"
								variant="secondary"
								onClick={() => vscode.postMessage({ type: "xaiSuperGrokCancelBrowserSignIn" })}>
								{t("settings:providers.xaiSuperGrok.cancel")}
							</Button>
						</div>
					</div>
				)}

				{status.phase === "device-waiting" && verificationUrl && (
					<div className="rounded bg-vscode-textBlockQuote-background p-3 flex flex-col gap-2">
						<div className="flex items-center gap-2 text-sm">
							<LoaderCircle className="size-4 animate-spin" />
							{t("settings:providers.xaiSuperGrok.deviceWaiting")}
						</div>
						<div className="text-xs break-all select-text">{status.verificationUri}</div>
						<div className="text-lg font-mono tracking-widest select-text">{status.userCode}</div>
						<div className="flex flex-wrap gap-2">
							<Button size="sm" variant="secondary" onClick={() => void copyToClipboard(verificationUrl)}>
								<Copy className="size-3.5" /> {t("settings:providers.xaiSuperGrok.copyLink")}
							</Button>
							<Button
								size="sm"
								variant="secondary"
								onClick={() => void copyToClipboard(status.userCode ?? "")}>
								<Copy className="size-3.5" /> {t("settings:providers.xaiSuperGrok.copyCode")}
							</Button>
							<Button
								size="sm"
								variant="secondary"
								onClick={() => vscode.postMessage({ type: "xaiSuperGrokCancelDeviceSignIn" })}>
								{t("settings:providers.xaiSuperGrok.cancel")}
							</Button>
						</div>
					</div>
				)}

				{status.phase === "error" && <div className="text-sm text-vscode-errorForeground">{status.error}</div>}
			</div>

			<div className="flex items-center justify-between gap-2">
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.xaiSuperGrok.modelsSource")}
				</div>
				<Button variant="secondary" size="sm" disabled={refreshing} onClick={refreshModels}>
					<RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
					{t("settings:providers.xaiSuperGrok.refreshModels")}
				</Button>
			</div>

			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={defaultModelId}
				models={models}
				modelIdKey="apiModelId"
				serviceName="SuperGrok / X Premium (OAuth)"
				serviceUrl="https://x.ai/grok"
				simplifySettings={simplifySettings}
			/>
		</div>
	)
}
