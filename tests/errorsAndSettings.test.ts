import { describe, expect, it } from "vitest";
import { describeCameraError } from "../src/errors";
import { DEFAULT_SETTINGS, parseSettings } from "../src/settings";

function domError(name: string, message = ""): Error {
	const e = new Error(message);
	e.name = name;
	return e;
}

describe("error guidance", () => {
	it("explains how to grant camera permission", () => {
		const info = describeCameraError(domError("NotAllowedError"));
		expect(info.title).toBe("Camera permission needed");
		expect(info.steps[0]).toContain("Android Settings");
		expect(info.retryable).toBe(true);
	});

	it("explains microphone permission separately", () => {
		const info = describeCameraError(domError("NotAllowedError"), "microphone");
		expect(info.title).toBe("Microphone permission needed");
		expect(info.steps[1]).toContain("Microphone");
	});

	it("maps busy and missing cameras", () => {
		expect(describeCameraError(domError("NotReadableError")).title).toBe("Camera is busy");
		expect(describeCameraError(domError("OverconstrainedError")).title).toBe("No camera found");
	});

	it("reports unsupported WebViews", () => {
		const info = describeCameraError(domError("UnsupportedError"));
		expect(info.retryable).toBe(false);
		expect(info.steps.join(" ")).toContain("Android System WebView");
	});

	it("treats unknown errors as unsupported when the API is missing (node has no mediaDevices)", () => {
		expect(describeCameraError(new Error("weird")).title).toBe("Camera not available");
	});
});

describe("settings parsing", () => {
	it("returns defaults for missing data", () => {
		expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
	});

	it("keeps valid values and rejects invalid ones", () => {
		const s = parseSettings({
			folderPattern: "  media  ",
			jpegQuality: 3,
			videoResolution: "4k",
			defaultFacing: "user",
			recordAudio: false,
			highResPhotos: "yes",
			maxVideoSeconds: 90.6,
		});
		expect(s).toEqual({
			cameraMode: "auto",
			inAppBlocked: false,
			folderPattern: "media",
			jpegQuality: 1,
			videoResolution: DEFAULT_SETTINGS.videoResolution,
			defaultFacing: "user",
			recordAudio: false,
			highResPhotos: DEFAULT_SETTINGS.highResPhotos,
			maxVideoSeconds: 91,
		});
	});
});
