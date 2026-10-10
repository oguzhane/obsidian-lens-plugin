import { describe, expect, it } from "vitest";
import { VIDEO_MIME_PREFERENCES, extensionForMime, formatDuration, pickVideoMimeType } from "../src/camera/recorder";

describe("video format selection", () => {
	it("prefers MP4 when supported", () => {
		expect(pickVideoMimeType(() => true)).toBe(VIDEO_MIME_PREFERENCES[0]);
	});

	it("falls back to WebM", () => {
		expect(pickVideoMimeType((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9,opus");
	});

	it("returns empty when nothing matches or the check throws", () => {
		expect(pickVideoMimeType(() => false)).toBe("");
		expect(
			pickVideoMimeType((t) => {
				if (t.includes("mp4")) throw new Error("boom");
				return t === "video/webm";
			}),
		).toBe("video/webm");
	});

	it("maps mime types to extensions", () => {
		expect(extensionForMime("video/mp4;codecs=avc1,mp4a.40.2")).toBe("mp4");
		expect(extensionForMime("video/webm;codecs=vp8,opus")).toBe("webm");
		expect(extensionForMime("VIDEO/X-MATROSKA;codecs=avc1")).toBe("mkv");
		expect(extensionForMime("image/jpeg")).toBe("jpg");
		expect(extensionForMime("video/unknown")).toBe("webm");
		expect(extensionForMime("")).toBe("jpg");
	});

	it("formats recording durations", () => {
		expect(formatDuration(0)).toBe("00:00");
		expect(formatDuration(65.9)).toBe("01:05");
		expect(formatDuration(3725)).toBe("1:02:05");
	});
});
