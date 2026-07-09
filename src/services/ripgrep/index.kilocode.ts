import * as cp from "child_process"
import fs from "fs/promises"
import path from "path"
import * as util from "util"

import { fileExistsAtPath } from "../../utils/fs"

/**
 * Newer VS Code versions (especially on Windows) store ripgrep under a dynamic
 * commit-hash subdirectory:
 *   <vscodeAppRoot>/<commitHash>/resources/app/node_modules/@vscode/ripgrep-universal/bin/<platform>-<arch>/<binName>
 *
 * Since <commitHash> is a dynamic directory name, we scan vscodeAppRoot for
 * subdirectories that contain the ripgrep binary.
 */
export async function checkCommitHashRipgrepPath(vscodeAppRoot: string, binName: string): Promise<string | undefined> {
	const universalBinFolder = `bin/${process.platform}-${process.arch}`
	const rgSubPath = path.join(
		"resources",
		"app",
		"node_modules",
		"@vscode",
		"ripgrep-universal",
		universalBinFolder,
		binName,
	)

	try {
		const entries = await fs.readdir(vscodeAppRoot, { withFileTypes: true })
		for (const entry of entries) {
			if (entry.isDirectory()) {
				const candidatePath = path.join(vscodeAppRoot, entry.name, rgSubPath)
				if (await fileExistsAtPath(candidatePath)) {
					return candidatePath
				}
			}
		}
	} catch {
		// Directory not readable or doesn't exist
	}

	return undefined
}

export async function checkBunPath(vscodeAppRoot: string, binName: string) {
	// For bun: resolve package and find binary (bun uses symlinks to global cache)
	try {
		const ripgrepPkg = require.resolve("@vscode/ripgrep/package.json", { paths: [vscodeAppRoot] })
		const ripgrepRoot = path.dirname(ripgrepPkg)
		const bunPath = path.join(ripgrepRoot, "bin", binName)
		if (await fileExistsAtPath(bunPath)) {
			return bunPath
		}
	} catch (error) {
		// Package not found via require.resolve
	}

	return undefined
}

/**
 * Last-resort fallback: try to locate ripgrep in the system PATH using
 * `where` (Windows) or `which` (Linux/macOS).
 */
export async function checkSystemPath(binName: string): Promise<string | undefined> {
	const cmd = process.platform.startsWith("win") ? "where" : "which"
	try {
		const { stdout } = await util.promisify(cp.execFile)(cmd, [binName], { encoding: "utf-8" })
		const result = stdout.trim().split(/\r?\n/)[0]
		if (result && (await fileExistsAtPath(result))) {
			return result
		}
	} catch {
		// rg not found in system PATH
	}

	return undefined
}
