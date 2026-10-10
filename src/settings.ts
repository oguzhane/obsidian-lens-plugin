export type FacingMode = "environment" | "user";
export type VideoResolution = "720p" | "1080p";

export interface LensSettings {
	/** Folder (relative to the note's folder) that captures are saved in. `{{noteName}}` is replaced; a leading `/` makes it vault-absolute. */
	folderPattern: string;
	/** JPEG quality for photos, 0.5 – 1. */
	jpegQuality: number;
	videoResolution: VideoResolution;
	defaultFacing: FacingMode;
	/** Whether video recordings include microphone audio by default. */
	recordAudio: boolean;
	/** Use the ImageCapture API for full-resolution photos when the device supports it. */
	highResPhotos: boolean;
	/** Stop recording automatically after this many seconds. 0 = unlimited. */
	maxVideoSeconds: number;
}

export const DEFAULT_FOLDER_PATTERN = "{{noteName}}.assets";

export const DEFAULT_SETTINGS: LensSettings = {
	folderPattern: DEFAULT_FOLDER_PATTERN,
	jpegQuality: 0.9,
	videoResolution: "1080p",
	defaultFacing: "environment",
	recordAudio: true,
	highResPhotos: true,
	maxVideoSeconds: 0,
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

/** Validates persisted plugin data, falling back to defaults for anything missing or invalid. */
export function parseSettings(raw: unknown): LensSettings {
	const data = isObject(raw) ? raw : {};
	const d = DEFAULT_SETTINGS;
	return {
		folderPattern:
			typeof data.folderPattern === "string" && data.folderPattern.trim() !== ""
				? data.folderPattern.trim()
				: d.folderPattern,
		jpegQuality: clampNumber(data.jpegQuality, 0.5, 1, d.jpegQuality),
		videoResolution: data.videoResolution === "720p" || data.videoResolution === "1080p" ? data.videoResolution : d.videoResolution,
		defaultFacing: data.defaultFacing === "user" || data.defaultFacing === "environment" ? data.defaultFacing : d.defaultFacing,
		recordAudio: typeof data.recordAudio === "boolean" ? data.recordAudio : d.recordAudio,
		highResPhotos: typeof data.highResPhotos === "boolean" ? data.highResPhotos : d.highResPhotos,
		maxVideoSeconds: Math.round(clampNumber(data.maxVideoSeconds, 0, 24 * 60 * 60, d.maxVideoSeconds)),
	};
}
