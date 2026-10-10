import type { FacingMode, VideoResolution } from "../settings";
import {
	ExtendedConstraintSet,
	ExtendedSupportedConstraints,
	ExtendedTrackCapabilities,
	ImageCaptureLike,
	PhotoCapabilitiesLike,
	getImageCaptureCtor,
	getSupportedConstraints,
	getTrackCapabilities,
} from "./mediaTypes";
import { ZoomRange, clampZoom, digitalCropRect } from "./zoom";

export interface CameraFeatures {
	/** Hardware zoom range, or null when only digital zoom is possible. */
	hardwareZoom: ZoomRange | null;
	torch: boolean;
	tapToFocus: boolean;
	pointsOfInterest: boolean;
	focusModes: string[];
	imageCapture: boolean;
	/** ImageCapture can fire the real flash for photos. */
	photoFlash: boolean;
}

export const NO_FEATURES: CameraFeatures = {
	hardwareZoom: null,
	torch: false,
	tapToFocus: false,
	pointsOfInterest: false,
	focusModes: [],
	imageCapture: false,
	photoFlash: false,
};

/** Pure mapping from reported capabilities to the controls the UI should show. */
export function featuresFromCapabilities(
	caps: ExtendedTrackCapabilities,
	supported: ExtendedSupportedConstraints,
	photoCaps: PhotoCapabilitiesLike | null,
	hasImageCapture: boolean,
): CameraFeatures {
	const zoom = caps.zoom;
	const hardwareZoom =
		zoom && typeof zoom.min === "number" && typeof zoom.max === "number" && zoom.max > zoom.min
			? { min: zoom.min, max: zoom.max, step: zoom.step > 0 ? zoom.step : 0.1 }
			: null;
	const focusModes = Array.isArray(caps.focusMode) ? caps.focusMode : [];
	const pointsOfInterest = supported.pointsOfInterest === true;
	return {
		hardwareZoom,
		torch: caps.torch === true,
		tapToFocus: focusModes.includes("single-shot") || (pointsOfInterest && focusModes.length > 0),
		pointsOfInterest,
		focusModes,
		imageCapture: hasImageCapture,
		photoFlash: hasImageCapture && !!photoCaps?.fillLightMode?.includes("flash"),
	};
}

const RESOLUTIONS: Record<VideoResolution, { width: number; height: number }> = {
	"720p": { width: 1280, height: 720 },
	"1080p": { width: 1920, height: 1080 },
};

export function buildVideoConstraints(facing: FacingMode, resolution: VideoResolution, requestZoom: boolean): MediaTrackConstraints {
	const r = RESOLUTIONS[resolution];
	const constraints: MediaTrackConstraints & ExtendedConstraintSet = {
		facingMode: { ideal: facing },
		width: { ideal: r.width },
		height: { ideal: r.height },
	};
	// Chromium only exposes/permits zoom control when it is requested up front.
	if (requestZoom) constraints.zoom = true;
	return constraints;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
		promise.then(
			(v) => {
				window.clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				window.clearTimeout(timer);
				reject(e);
			},
		);
	});
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image"))), type, quality);
	});
}

export interface PhotoOptions {
	video: HTMLVideoElement;
	digitalZoom: number;
	quality: number;
	useImageCapture: boolean;
	useFlash: boolean;
}

/** Owns the camera MediaStream and all track-level controls. */
export class CameraController {
	stream: MediaStream | null = null;
	features: CameraFeatures = NO_FEATURES;
	/** Called when the camera track ends unexpectedly (e.g. taken by another app). */
	onUnexpectedEnd: (() => void) | null = null;

	private imageCapture: ImageCaptureLike | null = null;
	private stopping = false;
	private zoomTarget: number | null = null;
	private zoomApplying = false;
	private focusResetTimer: number | null = null;

	get videoTrack(): MediaStreamTrack | null {
		return this.stream?.getVideoTracks()[0] ?? null;
	}

	get isActive(): boolean {
		return !!this.videoTrack && this.videoTrack.readyState === "live";
	}

	async start(facing: FacingMode, resolution: VideoResolution): Promise<MediaStream> {
		this.stop();
		if (!navigator.mediaDevices?.getUserMedia) {
			const err = new Error("navigator.mediaDevices.getUserMedia is not available");
			err.name = "UnsupportedError";
			throw err;
		}
		const supported = getSupportedConstraints();
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: buildVideoConstraints(facing, resolution, supported.zoom === true),
				audio: false,
			});
		} catch (err) {
			// Some WebViews reject the zoom/pan-tilt-zoom request; retry with plain constraints.
			if (supported.zoom === true && (err as Error)?.name !== "NotAllowedError") {
				stream = await navigator.mediaDevices.getUserMedia({
					video: buildVideoConstraints(facing, resolution, false),
					audio: false,
				});
			} else {
				throw err;
			}
		}
		this.stream = stream;
		this.stopping = false;

		const track = stream.getVideoTracks()[0];
		track?.addEventListener("ended", () => {
			if (!this.stopping) this.onUnexpectedEnd?.();
		});

		await this.detectFeatures(supported);
		return stream;
	}

	stop(): void {
		this.stopping = true;
		if (this.focusResetTimer !== null) {
			window.clearTimeout(this.focusResetTimer);
			this.focusResetTimer = null;
		}
		this.stream?.getTracks().forEach((t) => t.stop());
		this.stream = null;
		this.imageCapture = null;
		this.features = NO_FEATURES;
		this.zoomTarget = null;
	}

	private async detectFeatures(supported: ExtendedSupportedConstraints): Promise<void> {
		const track = this.videoTrack;
		if (!track) {
			this.features = NO_FEATURES;
			return;
		}
		const caps = getTrackCapabilities(track);
		const Ctor = getImageCaptureCtor();
		let photoCaps: PhotoCapabilitiesLike | null = null;
		this.imageCapture = null;
		if (Ctor) {
			try {
				this.imageCapture = new Ctor(track);
				photoCaps = await withTimeout(this.imageCapture.getPhotoCapabilities(), 3000, "getPhotoCapabilities");
			} catch {
				photoCaps = null;
			}
		}
		this.features = featuresFromCapabilities(caps, supported, photoCaps, !!this.imageCapture);
	}

	private async apply(set: ExtendedConstraintSet): Promise<void> {
		const track = this.videoTrack;
		if (!track) return;
		await track.applyConstraints({ advanced: [set as MediaTrackConstraintSet] });
	}

	/** Applies hardware zoom, coalescing rapid pinch updates so only the latest value is sent. */
	async setZoom(value: number): Promise<void> {
		const range = this.features.hardwareZoom;
		if (!range) return;
		this.zoomTarget = clampZoom(value, range);
		if (this.zoomApplying) return;
		this.zoomApplying = true;
		try {
			while (this.zoomTarget !== null) {
				const z = this.zoomTarget;
				this.zoomTarget = null;
				try {
					await this.apply({ zoom: z });
				} catch (err) {
					console.warn("Lens: zoom failed", err);
				}
			}
		} finally {
			this.zoomApplying = false;
		}
	}

	async setTorch(on: boolean): Promise<void> {
		if (!this.features.torch) return;
		try {
			await this.apply({ torch: on });
		} catch (err) {
			console.warn("Lens: torch failed", err);
		}
	}

	/** Focuses on a point given in normalized (0–1) frame coordinates. */
	async focusAt(x: number, y: number): Promise<void> {
		const f = this.features;
		if (!f.tapToFocus) return;
		const set: ExtendedConstraintSet = {};
		if (f.pointsOfInterest) set.pointsOfInterest = [{ x, y }];
		if (f.focusModes.includes("single-shot")) set.focusMode = "single-shot";
		else if (f.focusModes.includes("continuous")) set.focusMode = "continuous";
		try {
			await this.apply(set);
		} catch (err) {
			console.warn("Lens: focus failed", err);
			return;
		}
		// Return to continuous autofocus after a while so later shots/recording stay sharp.
		if (set.focusMode === "single-shot" && f.focusModes.includes("continuous")) {
			if (this.focusResetTimer !== null) window.clearTimeout(this.focusResetTimer);
			this.focusResetTimer = window.setTimeout(() => {
				this.focusResetTimer = null;
				void this.apply({ focusMode: "continuous" }).catch(() => undefined);
			}, 5000);
		}
	}

	/** Captures a JPEG. Prefers full-resolution ImageCapture, falling back to grabbing the preview frame. */
	async capturePhoto(opts: PhotoOptions): Promise<Blob> {
		let source: CanvasImageSource | null = null;
		let width = 0;
		let height = 0;
		let bitmap: ImageBitmap | null = null;

		if (opts.useImageCapture && this.imageCapture) {
			try {
				const blob = await withTimeout(
					this.imageCapture.takePhoto(this.features.photoFlash ? { fillLightMode: opts.useFlash ? "flash" : "off" } : undefined),
					8000,
					"takePhoto",
				);
				bitmap = await createImageBitmap(blob);
				source = bitmap;
				width = bitmap.width;
				height = bitmap.height;
			} catch (err) {
				console.warn("Lens: ImageCapture.takePhoto failed, using preview frame", err);
			}
		}

		if (!source) {
			const v = opts.video;
			if (!v.videoWidth || !v.videoHeight) throw new Error("Camera is not ready yet");
			source = v;
			width = v.videoWidth;
			height = v.videoHeight;
		}

		try {
			const crop = digitalCropRect(width, height, opts.digitalZoom);
			const canvas = document.createElement("canvas");
			canvas.width = Math.round(crop.width);
			canvas.height = Math.round(crop.height);
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("Canvas 2D context unavailable");
			ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
			return await canvasToBlob(canvas, "image/jpeg", opts.quality);
		} finally {
			bitmap?.close();
		}
	}

	/** True if the given photo will use the real flash (ImageCapture) rather than needing the torch. */
	willUseRealFlash(useImageCapture: boolean): boolean {
		return useImageCapture && !!this.imageCapture && this.features.photoFlash;
	}
}

/**
 * Draws the camera preview into a canvas with a centered crop so that digital zoom
 * is baked into recordings on devices without hardware zoom.
 */
export class CanvasZoomPipeline {
	readonly stream: MediaStream;
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private running = false;
	private rafHandle: number | null = null;

	constructor(private video: HTMLVideoElement, private getZoom: () => number, fps = 30) {
		this.canvas = document.createElement("canvas");
		this.canvas.width = video.videoWidth || 1280;
		this.canvas.height = video.videoHeight || 720;
		const ctx = this.canvas.getContext("2d");
		if (!ctx) throw new Error("Canvas 2D context unavailable");
		this.ctx = ctx;
		this.draw();
		this.stream = this.canvas.captureStream(fps);
	}

	start(): void {
		this.running = true;
		const loop = () => {
			if (!this.running) return;
			this.draw();
			this.rafHandle = window.requestAnimationFrame(loop);
		};
		this.rafHandle = window.requestAnimationFrame(loop);
	}

	stop(): void {
		this.running = false;
		if (this.rafHandle !== null) window.cancelAnimationFrame(this.rafHandle);
		this.rafHandle = null;
		this.stream.getTracks().forEach((t) => t.stop());
	}

	private draw(): void {
		const v = this.video;
		if (!v.videoWidth || !v.videoHeight) return;
		const crop = digitalCropRect(v.videoWidth, v.videoHeight, this.getZoom());
		this.ctx.drawImage(v, crop.x, crop.y, crop.width, crop.height, 0, 0, this.canvas.width, this.canvas.height);
	}
}
