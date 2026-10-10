import { describe, expect, it } from "vitest";
import {
	appendEmbed,
	buildBaseName,
	buildEmbedInsertion,
	formatTimestamp,
	joinVaultPath,
	resolveFolderPath,
	sanitizeSegment,
	toEmbed,
	uniqueFilePath,
} from "../src/storage/naming";

const date = new Date(2026, 9, 10, 23, 5, 9); // 2026-10-10 23:05:09 local

describe("file naming", () => {
	it("formats timestamps as yyyyMMdd_HHmmss", () => {
		expect(formatTimestamp(date)).toBe("20261010_230509");
	});

	it("prefixes photos and videos", () => {
		expect(buildBaseName("photo", date)).toBe("IMG_20261010_230509");
		expect(buildBaseName("video", date)).toBe("VID_20261010_230509");
	});

	it("adds a numeric suffix on collisions", () => {
		const existing = new Set(["A/IMG_1.jpg", "A/IMG_1_1.jpg"]);
		expect(uniqueFilePath("A", "IMG_1", "jpg", (p) => existing.has(p))).toBe("A/IMG_1_2.jpg");
		expect(uniqueFilePath("", "IMG_1", "jpg", () => false)).toBe("IMG_1.jpg");
	});
});

describe("folder resolution", () => {
	it("creates a <note>.assets folder next to the note", () => {
		expect(resolveFolderPath("Journal/2026/My note.md", "{{noteName}}.assets")).toBe("Journal/2026/My note.assets");
	});

	it("handles notes at the vault root", () => {
		expect(resolveFolderPath("Inbox.md", "{{noteName}}.assets")).toBe("Inbox.assets");
	});

	it("supports nested and vault-absolute patterns", () => {
		expect(resolveFolderPath("A/B.md", "media/{{ noteName }}")).toBe("A/media/B");
		expect(resolveFolderPath("A/B.md", "/Attachments/{{noteName}}")).toBe("Attachments/B");
	});

	it("falls back to the default pattern when empty", () => {
		expect(resolveFolderPath("A/B.md", "  ")).toBe("A/B.assets");
	});

	it("sanitizes unsafe characters and blocks traversal", () => {
		expect(resolveFolderPath("A/Q: what? #1.md", "{{noteName}}.assets")).toBe("A/Q- what- -1.assets");
		expect(resolveFolderPath("A/B.md", "../../{{noteName}}")).toBe("A/B");
		expect(resolveFolderPath("A/.hidden.md", "{{noteName}}")).toBe("A/hidden");
	});

	it("joins and sanitizes path pieces", () => {
		expect(joinVaultPath("a//b/", "./c", "")).toBe("a/b/c");
		expect(sanitizeSegment("..secret. ")).toBe("secret");
	});
});

describe("embed insertion", () => {
	it("turns links into embeds once", () => {
		expect(toEmbed("[[a.jpg]]")).toBe("![[a.jpg]]");
		expect(toEmbed("![](a.jpg)")).toBe("![](a.jpg)");
	});

	it("puts the embed on its own line", () => {
		expect(buildEmbedInsertion("![[a.jpg]]", "")).toBe("![[a.jpg]]\n");
		expect(buildEmbedInsertion("![[a.jpg]]", "Some text")).toBe("\n![[a.jpg]]\n");
	});

	it("appends to note content", () => {
		expect(appendEmbed("", "E")).toBe("E\n");
		expect(appendEmbed("text", "E")).toBe("text\nE\n");
		expect(appendEmbed("text\n", "E")).toBe("text\nE\n");
	});
});
