import { describe, expect, it } from "vitest";
import { DIGITAL_ZOOM_RANGE, clampZoom, containRect, digitalCropRect, formatZoom, pinchZoom, viewToFramePoint } from "../src/camera/zoom";

const hw = { min: 1, max: 10, step: 0.1 };

describe("zoom math", () => {
	it("clamps and snaps to step", () => {
		expect(clampZoom(0.2, hw)).toBe(1);
		expect(clampZoom(42, hw)).toBe(10);
		expect(clampZoom(2.345, hw)).toBe(2.3);
		expect(clampZoom(Number.NaN, hw)).toBe(1);
	});

	it("scales zoom with pinch distance", () => {
		expect(pinchZoom(1, 100, 200, hw)).toBe(2);
		expect(pinchZoom(4, 200, 100, hw)).toBe(2);
		expect(pinchZoom(2, 0, 100, hw)).toBe(2);
		expect(pinchZoom(1, 100, 10000, DIGITAL_ZOOM_RANGE)).toBe(DIGITAL_ZOOM_RANGE.max);
	});

	it("computes centered digital crops", () => {
		expect(digitalCropRect(1000, 500, 2)).toEqual({ x: 250, y: 125, width: 500, height: 250 });
		expect(digitalCropRect(1000, 500, 0.5)).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
	});

	it("computes object-fit: contain placement", () => {
		expect(containRect(400, 800, 1080, 1920)).toEqual({ x: 0, y: 44.44444444444446, width: 400, height: 711.1111111111111 });
		expect(containRect(0, 0, 10, 10)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
	});

	it("maps preview taps to frame coordinates", () => {
		expect(viewToFramePoint(0.5, 0.5, 3, false)).toEqual({ x: 0.5, y: 0.5 });
		expect(viewToFramePoint(1, 0, 2, false)).toEqual({ x: 0.75, y: 0.25 });
		expect(viewToFramePoint(0.2, 0.4, 1, true)).toEqual({ x: 0.8, y: 0.4 });
	});

	it("formats zoom labels", () => {
		expect(formatZoom(1)).toBe("1.0×");
		expect(formatZoom(2.25)).toBe("2.3×");
	});
});
