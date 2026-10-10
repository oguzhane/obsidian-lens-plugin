import { describe, expect, it } from "vitest";
import { extensionForMime, mimeForCapturedFile } from "../src/camera/recorder";
import { isCameraAccessBlocked } from "../src/errors";
import { parseSettings } from "../src/settings";

function domError(name: string): Error {
	const e = new Error(name);
	e.name = name;
	return e;
}

describe("camera-app captures", () => {
	it("uses the reported mime type when present", () => {
		expect(mimeForCapturedFile("x.bin", "image/jpeg", "photo")).toBe("image/jpeg");
		expect(mimeForCapturedFile("VID_1.mp4", "video/mp4", "video")).toBe("video/mp4");
	});

	it("derives the mime type from the file name when missing", () => {
		expect(mimeForCapturedFile("IMG_1.JPG", "", "photo")).toBe("image/jpeg");
		expect(mimeForCapturedFile("clip.3gp", "application/octet-stream", "video")).toBe("video/3gpp");
		expect(mimeForCapturedFile("clip.mov", "", "video")).toBe("video/quicktime");
	});

	it("falls back to sensible defaults", () => {
		expect(mimeForCapturedFile("1234", "", "photo")).toBe("image/jpeg");
		expect(mimeForCapturedFile("1234", "", "video")).toBe("video/mp4");
	});

	it("maps camera-app formats to extensions", () => {
		expect(extensionForMime("video/3gpp")).toBe("3gp");
		expect(extensionForMime("video/quicktime")).toBe("mov");
		expect(extensionForMime("image/heic")).toBe("heic");
	});
});

describe("in-app camera fallback", () => {
	it("treats permission and unsupported errors as blocked", () => {
		expect(isCameraAccessBlocked(domError("NotAllowedError"))).toBe(true);
		expect(isCameraAccessBlocked(domError("UnsupportedError"))).toBe(true);
	});

	it("treats any error as blocked when the camera API is missing (node has no mediaDevices)", () => {
		expect(isCameraAccessBlocked(domError("NotReadableError"))).toBe(true);
	});

	it("parses camera mode settings", () => {
		expect(parseSettings({}).cameraMode).toBe("auto");
		expect(parseSettings({}).inAppBlocked).toBe(false);
		expect(parseSettings({ cameraMode: "system", inAppBlocked: true })).toMatchObject({ cameraMode: "system", inAppBlocked: true });
		expect(parseSettings({ cameraMode: "bogus" }).cameraMode).toBe("auto");
	});
});
