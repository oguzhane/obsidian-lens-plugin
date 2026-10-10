import { DEFAULT_FOLDER_PATTERN } from "../settings";

export type CaptureKind = "photo" | "video";

function pad(n: number): string {
	return n.toString().padStart(2, "0");
}

/** Local time as `yyyyMMdd_HHmmss`. */
export function formatTimestamp(date: Date): string {
	return (
		`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
		`_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
	);
}

export function buildBaseName(kind: CaptureKind, date: Date): string {
	return `${kind === "photo" ? "IMG" : "VID"}_${formatTimestamp(date)}`;
}

/** Makes a single path segment safe for Obsidian file names and links. */
export function sanitizeSegment(segment: string): string {
	return segment
		.replace(/[\\/:*?"<>|#^[\]]/g, "-")
		.replace(/^\.+/, "")
		.replace(/[. ]+$/, "")
		.trim();
}

/** Joins path parts into a normalized vault path (no leading/trailing slashes, no `.`/`..` segments). */
export function joinVaultPath(...parts: string[]): string {
	const segments: string[] = [];
	for (const part of parts) {
		for (const raw of part.split(/[\\/]+/)) {
			const seg = raw.trim();
			if (seg === "" || seg === "." || seg === "..") continue;
			segments.push(seg);
		}
	}
	return segments.join("/");
}

/**
 * Resolves the folder captures for `notePath` should be stored in.
 * The pattern is relative to the note's folder unless it starts with `/` (vault root).
 */
export function resolveFolderPath(notePath: string, pattern: string): string {
	const slash = notePath.lastIndexOf("/");
	const noteDir = slash >= 0 ? notePath.slice(0, slash) : "";
	const fileName = notePath.slice(slash + 1);
	const noteName = sanitizeSegment(fileName.replace(/\.md$/i, "")) || "Untitled";

	const effective = pattern.trim() === "" ? DEFAULT_FOLDER_PATTERN : pattern.trim();
	const isAbsolute = effective.startsWith("/");
	const expanded = effective.replace(/\{\{\s*noteName\s*\}\}/g, noteName);
	const folder = joinVaultPath(...expanded.split("/").map((s) => sanitizeSegment(s)));

	return isAbsolute ? folder : joinVaultPath(noteDir, folder);
}

/** Returns the first `folder/base[_n].ext` path for which `exists` is false. */
export function uniqueFilePath(folder: string, base: string, ext: string, exists: (path: string) => boolean): string {
	const prefix = folder ? `${folder}/` : "";
	let candidate = `${prefix}${base}.${ext}`;
	for (let i = 1; exists(candidate); i++) {
		candidate = `${prefix}${base}_${i}.${ext}`;
	}
	return candidate;
}

/** Turns a markdown/wiki link into an embed. */
export function toEmbed(link: string): string {
	return link.startsWith("!") ? link : `!${link}`;
}

/** Text to insert at the cursor: puts the embed on its own line. */
export function buildEmbedInsertion(embed: string, lineBeforeCursor: string): string {
	return `${lineBeforeCursor.trim() !== "" ? "\n" : ""}${embed}\n`;
}

/** Appends an embed to the end of a note's content on its own line. */
export function appendEmbed(content: string, embed: string): string {
	const sep = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
	return `${content}${sep}${embed}\n`;
}
