/** Preferred recording formats, best first. MP4 plays everywhere; WebM is the long-standing WebView default. */
export const VIDEO_MIME_PREFERENCES = [
	"video/mp4;codecs=avc1,mp4a.40.2",
	"video/mp4;codecs=avc1",
	"video/mp4",
	"video/webm;codecs=vp9,opus",
	"video/webm;codecs=vp8,opus",
	"video/webm",
];

/** Returns the first supported preferred mime type, or `""` to let the browser decide. */
export function pickVideoMimeType(isSupported: (type: string) => boolean): string {
	for (const type of VIDEO_MIME_PREFERENCES) {
		try {
			if (isSupported(type)) return type;
		} catch {
			// ignore and try the next candidate
		}
	}
	return "";
}

/** File extension for a recorded/captured mime type. */
export function extensionForMime(mime: string): string {
	const base = mime.split(";")[0].trim().toLowerCase();
	switch (base) {
		case "video/mp4":
			return "mp4";
		case "video/webm":
			return "webm";
		case "video/x-matroska":
			return "mkv";
		case "video/quicktime":
			return "mov";
		case "video/3gpp":
			return "3gp";
		case "image/png":
			return "png";
		case "image/webp":
			return "webp";
		case "image/heic":
			return "heic";
		case "image/heif":
			return "heif";
		case "image/jpeg":
		case "image/jpg":
			return "jpg";
		default:
			return base.startsWith("video/") ? "webm" : "jpg";
	}
}

const MIME_BY_EXTENSION: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	heic: "image/heic",
	heif: "image/heif",
	mp4: "video/mp4",
	m4v: "video/mp4",
	webm: "video/webm",
	mkv: "video/x-matroska",
	mov: "video/quicktime",
	"3gp": "video/3gpp",
};

/**
 * Mime type for a file returned by the system camera. Android content providers
 * sometimes omit `type`, so fall back to the file name, then to a sensible default.
 */
export function mimeForCapturedFile(name: string, type: string, kind: "photo" | "video"): string {
	if (type && type !== "application/octet-stream") return type;
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
	return MIME_BY_EXTENSION[ext] ?? (kind === "photo" ? "image/jpeg" : "video/mp4");
}

/** Whether a picked file is a video or a photo, using its mime type or, failing that, its extension. */
export function captureKindForFile(name: string, type: string): "photo" | "video" {
	if (type.startsWith("video/")) return "video";
	if (type.startsWith("image/")) return "photo";
	return mimeForCapturedFile(name, "", "photo").startsWith("video/") ? "video" : "photo";
}

export function formatDuration(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const mm = m.toString().padStart(2, "0");
	const ss = sec.toString().padStart(2, "0");
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Thin promise-based wrapper around MediaRecorder. */
export class VideoRecorder {
	private recorder: MediaRecorder;
	private chunks: Blob[] = [];
	private stopped: Promise<Blob>;

	constructor(stream: MediaStream, preferredMime: string) {
		let recorder: MediaRecorder;
		try {
			recorder = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
		} catch {
			recorder = new MediaRecorder(stream);
		}
		this.recorder = recorder;
		recorder.addEventListener("dataavailable", (e: BlobEvent) => {
			if (e.data && e.data.size > 0) this.chunks.push(e.data);
		});
		this.stopped = new Promise<Blob>((resolve, reject) => {
			recorder.addEventListener("stop", () => resolve(new Blob(this.chunks, { type: this.mimeType })));
			recorder.addEventListener("error", (e) => reject((e as unknown as { error?: Error }).error ?? new Error("Recording failed")));
		});
		// Avoid unhandled-rejection noise if nobody awaits stop() after an error.
		this.stopped.catch(() => undefined);
	}

	/** Actual mime type chosen by the recorder (may include codecs). */
	get mimeType(): string {
		return this.recorder.mimeType || "video/webm";
	}

	get isRecording(): boolean {
		return this.recorder.state === "recording";
	}

	start(): void {
		// Chunk every second so data isn't lost if the WebView is interrupted.
		this.recorder.start(1000);
	}

	stop(): Promise<Blob> {
		if (this.recorder.state !== "inactive") this.recorder.stop();
		return this.stopped;
	}
}
