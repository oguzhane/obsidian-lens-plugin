/**
 * Image Capture / camera-control extensions that are implemented by Chromium (and therefore
 * Android System WebView) but are not part of TypeScript's lib.dom typings.
 */

export interface RangeCapability {
	min: number;
	max: number;
	step: number;
}

export interface ExtendedTrackCapabilities extends MediaTrackCapabilities {
	zoom?: RangeCapability;
	torch?: boolean;
	focusMode?: string[];
}

export interface ExtendedSupportedConstraints extends MediaTrackSupportedConstraints {
	zoom?: boolean;
	torch?: boolean;
	focusMode?: boolean;
	pointsOfInterest?: boolean;
}

export interface ExtendedConstraintSet extends MediaTrackConstraintSet {
	zoom?: number | boolean;
	torch?: boolean;
	focusMode?: string;
	pointsOfInterest?: Array<{ x: number; y: number }>;
}

export interface PhotoCapabilitiesLike {
	fillLightMode?: string[];
	imageWidth?: RangeCapability;
	imageHeight?: RangeCapability;
}

export interface PhotoSettingsLike {
	fillLightMode?: "auto" | "off" | "flash";
	imageWidth?: number;
	imageHeight?: number;
}

export interface ImageCaptureLike {
	takePhoto(settings?: PhotoSettingsLike): Promise<Blob>;
	getPhotoCapabilities(): Promise<PhotoCapabilitiesLike>;
}

export type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

export function getImageCaptureCtor(): ImageCaptureCtor | null {
	const ctor = (globalThis as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
	return typeof ctor === "function" ? ctor : null;
}

export function getSupportedConstraints(): ExtendedSupportedConstraints {
	try {
		return (navigator.mediaDevices?.getSupportedConstraints?.() ?? {}) as ExtendedSupportedConstraints;
	} catch {
		return {};
	}
}

export function getTrackCapabilities(track: MediaStreamTrack): ExtendedTrackCapabilities {
	try {
		return typeof track.getCapabilities === "function" ? (track.getCapabilities() as ExtendedTrackCapabilities) : {};
	} catch {
		return {};
	}
}
