// npx vitest run src/services/ripgrep/__tests__/index.spec.ts

import * as path from "path" // kilocode_change
import { getBinPath, truncateLine } from "../index" // kilocode_change
import { fileExistsAtPath } from "../../../utils/fs" // kilocode_change
import { checkBunPath, checkCommitHashRipgrepPath, checkSystemPath } from "../index.kilocode" // kilocode_change
// kilocode_change start
vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(),
}))

vi.mock("../index.kilocode", () => ({
	checkCommitHashRipgrepPath: vi.fn(),
	checkBunPath: vi.fn(),
	checkSystemPath: vi.fn(),
}))
// kilocode_change end
describe("Ripgrep line truncation", () => {
	// The default MAX_LINE_LENGTH is 500 in the implementation
	const MAX_LINE_LENGTH = 500

	it("should truncate lines longer than MAX_LINE_LENGTH", () => {
		const longLine = "a".repeat(600) // Line longer than MAX_LINE_LENGTH
		const truncated = truncateLine(longLine)

		expect(truncated).toContain("[truncated...]")
		expect(truncated.length).toBeLessThan(longLine.length)
		expect(truncated.length).toEqual(MAX_LINE_LENGTH + " [truncated...]".length)
	})

	it("should not truncate lines shorter than MAX_LINE_LENGTH", () => {
		const shortLine = "Short line of text"
		const truncated = truncateLine(shortLine)

		expect(truncated).toEqual(shortLine)
		expect(truncated).not.toContain("[truncated...]")
	})

	it("should correctly truncate a line at exactly MAX_LINE_LENGTH characters", () => {
		const exactLine = "a".repeat(MAX_LINE_LENGTH)
		const exactPlusOne = exactLine + "x"

		// Should not truncate when exactly MAX_LINE_LENGTH
		expect(truncateLine(exactLine)).toEqual(exactLine)

		// Should truncate when exceeding MAX_LINE_LENGTH by even 1 character
		expect(truncateLine(exactPlusOne)).toContain("[truncated...]")
	})

	it("should handle empty lines without errors", () => {
		expect(truncateLine("")).toEqual("")
	})

	it("should allow custom maximum length", () => {
		const customLength = 100
		const line = "a".repeat(customLength + 50)

		const truncated = truncateLine(line, customLength)

		expect(truncated.length).toEqual(customLength + " [truncated...]".length)
		expect(truncated).toContain("[truncated...]")
	})
})
// kilocode_change start
describe("getBinPath", () => {
	const mockFileExists = fileExistsAtPath as ReturnType<typeof vi.fn>
	const isWindows = process.platform.startsWith("win")
	const binName = isWindows ? "rg.exe" : "rg"

	beforeEach(() => {
		vi.clearAllMocks()
		// Default: kilocode fallback functions find nothing
		vi.mocked(checkCommitHashRipgrepPath).mockResolvedValue(undefined)
		vi.mocked(checkBunPath).mockResolvedValue(undefined)
		vi.mocked(checkSystemPath).mockResolvedValue(undefined)
	})

	it("should find ripgrep in traditional node_modules/@vscode/ripgrep/bin/", async () => {
		const vscodeAppRoot = "/path/to/vscode"
		const expectedPath = path.join(vscodeAppRoot, "node_modules/@vscode/ripgrep/bin/", binName)

		mockFileExists.mockImplementation(async (filePath: string) => filePath === expectedPath)

		const result = await getBinPath(vscodeAppRoot)
		expect(result).toBe(expectedPath)
	})

	it("should find ripgrep in node_modules/vscode-ripgrep/bin", async () => {
		const vscodeAppRoot = "/path/to/vscode"
		const expectedPath = path.join(vscodeAppRoot, "node_modules/vscode-ripgrep/bin", binName)

		mockFileExists.mockImplementation(async (filePath: string) => filePath === expectedPath)

		const result = await getBinPath(vscodeAppRoot)
		expect(result).toBe(expectedPath)
	})

	it("should find ripgrep in node_modules.asar.unpacked paths", async () => {
		const vscodeAppRoot = "/path/to/vscode"
		const expectedPath = path.join(vscodeAppRoot, "node_modules.asar.unpacked/vscode-ripgrep/bin/", binName)

		mockFileExists.mockImplementation(async (filePath: string) => filePath === expectedPath)

		const result = await getBinPath(vscodeAppRoot)
		expect(result).toBe(expectedPath)
	})

	it("should use checkBunPath fallback when traditional paths fail", async () => {
		const vscodeAppRoot = "/path/to/vscode"
		const bunPath = path.join("/global/cache/@vscode/ripgrep/bin", binName)

		// Traditional paths don't exist
		mockFileExists.mockResolvedValue(false)
		vi.mocked(checkBunPath).mockResolvedValue(bunPath)

		const result = await getBinPath(vscodeAppRoot)

		expect(result).toBe(bunPath)
	})

	it("should return undefined when ripgrep is not found anywhere", async () => {
		const vscodeAppRoot = "/path/to/nonexistent"

		// Mock all paths not existing
		mockFileExists.mockResolvedValue(false)

		const result = await getBinPath(vscodeAppRoot)

		// Should return undefined when no paths exist and require.resolve fails
		expect(result).toBeUndefined()
	})

	it("should prioritize traditional paths over require.resolve", async () => {
		const vscodeAppRoot = "/path/to/vscode"
		const traditionalPath = path.join(vscodeAppRoot, "node_modules/@vscode/ripgrep/bin/", binName)

		// Mock traditional path existing
		mockFileExists.mockImplementation(async (filePath: string) => {
			return filePath === traditionalPath
		})

		const result = await getBinPath(vscodeAppRoot)

		// Should return traditional path when it exists
		expect(result).toBe(traditionalPath)
	})

	it("should find ripgrep under a commit-hash subdirectory (newer VS Code)", async () => {
		const vscodeAppRoot = "/path/to/vscode"
		const commitHashPath = path.join(
			vscodeAppRoot,
			"abc123def",
			"resources",
			"app",
			"node_modules",
			"@vscode",
			"ripgrep-universal",
			`bin/${process.platform}-${process.arch}`,
			binName,
		)

		// Traditional paths don't exist
		mockFileExists.mockResolvedValue(false)
		// Commit-hash scan finds the binary
		vi.mocked(checkCommitHashRipgrepPath).mockResolvedValue(commitHashPath)

		const result = await getBinPath(vscodeAppRoot)

		expect(result).toBe(commitHashPath)
	})

	it("should fall back to system PATH (where/which) as last resort", async () => {
		const vscodeAppRoot = "/path/to/vscode"
		const systemPath = "/usr/local/bin/" + binName

		// Nothing exists in vscodeAppRoot
		mockFileExists.mockResolvedValue(false)
		// System PATH finds the binary
		vi.mocked(checkSystemPath).mockResolvedValue(systemPath)

		const result = await getBinPath(vscodeAppRoot)

		expect(result).toBe(systemPath)
	})

	it("should prioritize traditional paths over commit-hash and system paths", async () => {
		const vscodeAppRoot = "/path/to/vscode"
		const traditionalPath = path.join(
			vscodeAppRoot,
			"node_modules/@vscode/ripgrep-universal",
			`bin/${process.platform}-${process.arch}`,
			binName,
		)

		mockFileExists.mockImplementation(async (filePath: string) => filePath === traditionalPath)
		vi.mocked(checkCommitHashRipgrepPath).mockResolvedValue("/some/commit/hash/" + binName)
		vi.mocked(checkSystemPath).mockResolvedValue("/usr/local/bin/" + binName)

		const result = await getBinPath(vscodeAppRoot)

		expect(result).toBe(traditionalPath)
	})
})
// kilocode_change end
