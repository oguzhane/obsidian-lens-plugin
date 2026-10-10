import { describe, expect, it } from "vitest";
import { buildVideoConstraints, featuresFromCapabilities } from "../src/camera/CameraController";

describe("camera feature detection", () => {
	it("enables everything a capable back camera reports", () => {
		const f = featuresFromCapabilities(
			{ zoom: { min: 1, max: 8, step: 0.1 }, torch: true, focusMode: ["manual", "single-shot", "continuous"] },
			{ pointsOfInterest: true, zoom: true },
			{ fillLightMode: ["auto", "off", "flash"] },
			true,
		);
		expect(f).toEqual({
			hardwareZoom: { min: 1, max: 8, step: 0.1 },
			torch: true,
			tapToFocus: true,
			pointsOfInterest: true,
			focusModes: ["manual", "single-shot", "continuous"],
			imageCapture: true,
			photoFlash: true,
		});
	});

	it("falls back to digital zoom and hides unsupported controls", () => {
		const f = featuresFromCapabilities({ zoom: { min: 1, max: 1, step: 0.1 } }, {}, null, false);
		expect(f.hardwareZoom).toBeNull();
		expect(f.torch).toBe(false);
		expect(f.tapToFocus).toBe(false);
		expect(f.photoFlash).toBe(false);
	});

	it("only offers real flash when ImageCapture exists", () => {
		const f = featuresFromCapabilities({}, {}, { fillLightMode: ["flash"] }, false);
		expect(f.photoFlash).toBe(false);
	});

	it("defaults a zero zoom step", () => {
		const f = featuresFromCapabilities({ zoom: { min: 1, max: 4, step: 0 } }, {}, null, false);
		expect(f.hardwareZoom).toEqual({ min: 1, max: 4, step: 0.1 });
	});
});

describe("video constraints", () => {
	it("requests facing mode, resolution and optionally zoom", () => {
		expect(buildVideoConstraints("environment", "1080p", true)).toEqual({
			facingMode: { ideal: "environment" },
			width: { ideal: 1920 },
			height: { ideal: 1080 },
			zoom: true,
		});
		expect(buildVideoConstraints("user", "720p", false)).toEqual({
			facingMode: { ideal: "user" },
			width: { ideal: 1280 },
			height: { ideal: 720 },
		});
	});
});
