export interface ZoomRange {
	min: number;
	max: number;
	step: number;
}

/** Range used when the camera has no hardware zoom and we crop the frame instead. */
export const DIGITAL_ZOOM_RANGE: ZoomRange = { min: 1, max: 5, step: 0.1 };

export function clampZoom(value: number, range: ZoomRange): number {
	if (!Number.isFinite(value)) return range.min;
	const clamped = Math.min(range.max, Math.max(range.min, value));
	if (range.step > 0) {
		const stepped = range.min + Math.round((clamped - range.min) / range.step) * range.step;
		return Math.min(range.max, Math.max(range.min, Number(stepped.toFixed(4))));
	}
	return clamped;
}

/** New zoom level for a pinch gesture that started at `startZoom` with fingers `startDistance` apart. */
export function pinchZoom(startZoom: number, startDistance: number, currentDistance: number, range: ZoomRange): number {
	if (startDistance <= 0) return clampZoom(startZoom, range);
	return clampZoom(startZoom * (currentDistance / startDistance), range);
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Centered crop of a `width`×`height` frame for a digital zoom factor. */
export function digitalCropRect(width: number, height: number, zoom: number): Rect {
	const z = Math.max(1, zoom);
	const w = width / z;
	const h = height / z;
	return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

/** Where a video with intrinsic size `videoW`×`videoH` is drawn inside a box using `object-fit: contain`. */
export function containRect(boxW: number, boxH: number, videoW: number, videoH: number): Rect {
	if (boxW <= 0 || boxH <= 0 || videoW <= 0 || videoH <= 0) return { x: 0, y: 0, width: boxW, height: boxH };
	const scale = Math.min(boxW / videoW, boxH / videoH);
	const width = videoW * scale;
	const height = videoH * scale;
	return { x: (boxW - width) / 2, y: (boxH - height) / 2, width, height };
}

/**
 * Maps a normalized point on the (possibly digitally zoomed and mirrored) preview
 * to a normalized point on the actual camera frame.
 */
export function viewToFramePoint(nx: number, ny: number, digitalZoom: number, mirrored: boolean): { x: number; y: number } {
	const z = Math.max(1, digitalZoom);
	let x = 0.5 + (nx - 0.5) / z;
	const y = 0.5 + (ny - 0.5) / z;
	if (mirrored) x = 1 - x;
	return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

export function formatZoom(zoom: number): string {
	return `${zoom.toFixed(1)}×`;
}
