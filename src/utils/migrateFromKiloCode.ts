// kilocode_change - new file: Configuration migration from Kilo Code to Gilo Code
import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as fsSync from "fs"
import * as path from "path"

const OLD_EXTENSION_ID = "kilocode.kilo-code"
const OLD_CONFIG_PREFIX = "kilo-code"
const MIGRATION_KEY = "giloCodeConfigMigrationCompleted"

/**
 * Mapping of old VS Code configuration keys to new keys.
 * The prefix changes from "kilo-code" to "gilo-code".
 */
const OLD_TO_NEW_CONFIG_SUFFIXES = [
	"allowedCommands",
	"deniedCommands",
	"commandExecutionTimeout",
	"commandTimeoutAllowlist",
	"preventCompletionWithOpenTodos",
	"vsCodeLmModelSelector",
	"customStoragePath",
	"enableCodeActions",
	"autoImportSettingsPath",
	"maximumIndexedFilesForFileSearch",
	"useAgentRules",
	"apiRequestTimeout",
	"newTaskRequireTodos",
	"enableSettingsSync",
	"codeIndex.embeddingBatchSize",
	"toolProtocol",
	"debug",
	"debugProxy.enabled",
	"debugProxy.serverUrl",
	"debugProxy.tlsInsecure",
]

/**
 * Recursively copy a directory, skipping files that already exist in the destination.
 */
async function copyDirMerge(src: string, dest: string): Promise<number> {
	let copiedCount = 0

	await fs.mkdir(dest, { recursive: true })
	const entries = await fs.readdir(src, { withFileTypes: true })

	for (const entry of entries) {
		const srcPath = path.join(src, entry.name)
		const destPath = path.join(dest, entry.name)

		if (entry.isDirectory()) {
			copiedCount += await copyDirMerge(srcPath, destPath)
		} else {
			// Only copy if destination doesn't have the file
			if (!fsSync.existsSync(destPath)) {
				await fs.copyFile(srcPath, destPath)
				copiedCount++
			}
		}
	}

	return copiedCount
}

/**
 * Migrate VS Code settings from old "kilo-code.*" prefix to new "gilo-code.*" prefix.
 * Only copies settings that don't already exist in the new configuration.
 */
async function migrateVSCodeSettings(outputChannel: vscode.OutputChannel): Promise<number> {
	let migratedCount = 0
	const oldConfig = vscode.workspace.getConfiguration(OLD_CONFIG_PREFIX)
	const newConfig = vscode.workspace.getConfiguration("gilo-code")

	for (const suffix of OLD_TO_NEW_CONFIG_SUFFIXES) {
		try {
			// Check if the old config has a value for this key
			const oldValue = oldConfig.inspect(suffix)

			// Determine the effective value (global > default)
			const effectiveValue = oldValue?.globalValue ?? oldValue?.defaultValue

			if (effectiveValue === undefined) {
				continue
			}

			// Check if new config already has a non-default value
			const newValue = newConfig.inspect(suffix)
			if (newValue?.globalValue !== undefined) {
				// New config already has a user-set value, skip
				continue
			}

			// Copy the value to the new config
			await newConfig.update(suffix, effectiveValue, vscode.ConfigurationTarget.Global)
			migratedCount++
		} catch (error) {
			outputChannel.appendLine(
				`[GiloCode Migration] Failed to migrate setting "${suffix}": ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	return migratedCount
}

/**
 * Main migration function. Called during extension activation.
 *
 * On first run of Gilo Code, this function:
 * 1. Checks if the old Kilo Code extension's globalStorage directory exists
 * 2. Copies its contents (settings files, task history, cache, etc.) to the new location
 * 3. Migrates VS Code settings from "kilo-code.*" to "gilo-code.*" keys
 * 4. Marks the migration as complete
 */
export async function migrateFromKiloCode(
	context: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
): Promise<void> {
	// Check if migration has already been done
	if (context.globalState.get(MIGRATION_KEY)) {
		return
	}

	outputChannel.appendLine(
		"[GiloCode Migration] First run detected, checking for Kilo Code configuration to migrate...",
	)

	const newStoragePath = context.globalStorageUri.fsPath
	const oldStoragePath = newStoragePath.replace("gilocode.gilo-code", OLD_EXTENSION_ID)

	let totalFiles = 0
	let totalSettings = 0

	try {
		// Step 1: Copy globalStorage directory
		if (fsSync.existsSync(oldStoragePath)) {
			outputChannel.appendLine(`[GiloCode Migration] Found old storage at: ${oldStoragePath}`)
			totalFiles = await copyDirMerge(oldStoragePath, newStoragePath)
			outputChannel.appendLine(`[GiloCode Migration] Copied ${totalFiles} file(s) from Kilo Code storage`)
		} else {
			outputChannel.appendLine(
				"[GiloCode Migration] No Kilo Code storage directory found, skipping file migration",
			)
		}

		// Step 2: Migrate VS Code settings
		totalSettings = await migrateVSCodeSettings(outputChannel)
		if (totalSettings > 0) {
			outputChannel.appendLine(`[GiloCode Migration] Migrated ${totalSettings} VS Code setting(s)`)
		}

		// Show user notification if anything was migrated
		if (totalFiles > 0 || totalSettings > 0) {
			vscode.window.showInformationMessage(
				`Gilo Code: Successfully imported configuration from Kilo Code (${totalFiles} file(s), ${totalSettings} setting(s)).`,
			)
		}
	} catch (error) {
		outputChannel.appendLine(
			`[GiloCode Migration] Error during migration: ${error instanceof Error ? error.message : String(error)}`,
		)
	} finally {
		// Mark migration as complete regardless of success/failure
		await context.globalState.update(MIGRATION_KEY, true)
		outputChannel.appendLine("[GiloCode Migration] Migration completed")
	}
}
