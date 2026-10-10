import { App, Modal, Notice, setIcon } from "obsidian";
import type { FacingMode, LensSettings } from "../settings";
import { CameraController, CanvasZoomPipeline } from "../camera/CameraController";
import { VideoRecorder, formatDuration, pickVideoMimeType } from "../camera/recorder";
import { DIGITAL_ZOOM_RANGE, ZoomRange, clampZoom, containRect, formatZoom, pinchZoom, viewToFramePoint } from "../camera/zoom";
import { CameraErrorInfo, describeCameraError } from "../errors";
import type { MediaStore } from "../storage/MediaStore";
import type { NoteTarget } from "../storage/NoteTarget";
import type { CaptureKind } from "../storage/naming";

type CaptureMode = "photo" | "video";
type FlashMode = "off" | "flash" | "torch";

export interface CameraModalDeps {
	getSettings(): LensSettings;
	store: MediaStore;
	target: NoteTarget;
	onClosed?(): void;
}

const FLASH_ICONS: Record<FlashMode, string> = { off: "zap-off", flash: "zap", torch: "flashlight" };
const FLASH_LABELS: Record<FlashMode, string> = { off: "Flash off", flash: "Flash on", torch: "Torch on" };

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function touchDistance(a: Touch, b: Touch): number {
	return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function messageOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Full-screen live camera. Every capture is saved and embedded immediately; the camera stays open (burst mode). */
export class CameraModal extends Modal {
	private controller = new CameraController();
	private settings: LensSettings;
	private mode: CaptureMode = "photo";
	private flash: FlashMode = "off";
	private audioOn: boolean;
	private facing: FacingMode;
	private zoom = 1;

	private starting: Promise<void> | null = null;
	private recorder: VideoRecorder | null = null;
	private recordingStop: Promise<void> | null = null;
	private recordingBusy = false;
	private pipeline: CanvasZoomPipeline | null = null;
	private audioStream: MediaStream | null = null;
	private recordStartedAt = 0;
	private timerHandle: number | null = null;
	private maxTimer: number | null = null;

	private saveQueue: Promise<void> = Promise.resolve();
	private savedCount = 0;
	private thumbUrl: string | null = null;
	private photoBusy = false;
	private closed = false;
	private suspended = false;

	private pinch: { distance: number; zoom: number } | null = null;
	private tap: { x: number; y: number; time: number } | null = null;
	private focusRingTimer: number | null = null;

	private rootEl!: HTMLElement;
	private viewportEl!: HTMLElement;
	private videoEl!: HTMLVideoElement;
	private focusRingEl!: HTMLElement;
	private flashOverlayEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private errorEl!: HTMLElement;
	private timerEl!: HTMLElement;
	private flashBtn!: HTMLButtonElement;
	private audioBtn!: HTMLButtonElement;
	private zoomWrapEl!: HTMLElement;
	private zoomSlider!: HTMLInputElement;
	private zoomLabel!: HTMLButtonElement;
	private photoModeBtn!: HTMLButtonElement;
	private videoModeBtn!: HTMLButtonElement;
	private thumbEl!: HTMLElement;
	private countEl!: HTMLElement;
	private shutterBtn!: HTMLButtonElement;
	private switchBtn!: HTMLButtonElement;

	constructor(app: App, private deps: CameraModalDeps) {
		super(app);
		this.settings = deps.getSettings();
		this.audioOn = this.settings.recordAudio;
		this.facing = this.settings.defaultFacing;
	}

	onOpen(): void {
		this.modalEl.addClass("lens-modal");
		this.containerEl.addClass("lens-modal-container");
		this.buildUi();
		document.addEventListener("visibilitychange", this.onVisibilityChange);
		this.controller.onUnexpectedEnd = () => this.handleTrackEnded();
		void this.startCamera();
	}

	onClose(): void {
		this.closed = true;
		document.removeEventListener("visibilitychange", this.onVisibilityChange);
		this.controller.onUnexpectedEnd = null;
		this.clearTimers();
		if (!this.recorder) this.controller.stop();
		void this.finish();
		this.deps.onClosed?.();
	}

	/** Finalizes an in-progress recording and pending saves after the modal is closed. */
	private async finish(): Promise<void> {
		if (this.recorder) await this.stopRecording();
		this.controller.stop();
		await this.saveQueue;
		if (this.thumbUrl) URL.revokeObjectURL(this.thumbUrl);
		this.thumbUrl = null;
		if (this.savedCount > 0) {
			const n = this.savedCount;
			new Notice(`Lens: added ${n} capture${n === 1 ? "" : "s"} to ${this.deps.target.file.basename}`);
		}
	}

	// ---------------------------------------------------------------- UI

	private buildUi(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.rootEl = contentEl.createDiv({ cls: "lens-root" });

		this.viewportEl = this.rootEl.createDiv({ cls: "lens-viewport" });
		this.videoEl = this.viewportEl.createEl("video", { cls: "lens-video" });
		this.videoEl.muted = true;
		this.videoEl.autoplay = true;
		this.videoEl.playsInline = true;
		this.videoEl.setAttribute("playsinline", "");
		this.focusRingEl = this.viewportEl.createDiv({ cls: "lens-focus-ring" });
		this.flashOverlayEl = this.viewportEl.createDiv({ cls: "lens-shutter-flash" });
		this.statusEl = this.viewportEl.createDiv({ cls: "lens-status" });
		this.errorEl = this.rootEl.createDiv({ cls: "lens-error" });
		this.errorEl.hide();

		this.viewportEl.addEventListener("touchstart", this.onTouchStart, { passive: false });
		this.viewportEl.addEventListener("touchmove", this.onTouchMove, { passive: false });
		this.viewportEl.addEventListener("touchend", this.onTouchEnd);
		this.viewportEl.addEventListener("touchcancel", this.onTouchEnd);

		// Top bar
		const top = this.rootEl.createDiv({ cls: "lens-topbar" });
		const closeBtn = this.iconButton(top, "x", "Close camera", "lens-close");
		closeBtn.onclick = () => this.close();
		this.timerEl = top.createDiv({ cls: "lens-timer" });
		this.timerEl.hide();
		const right = top.createDiv({ cls: "lens-topbar-right" });
		this.audioBtn = this.iconButton(right, "mic", "Sound on", "lens-audio");
		this.audioBtn.onclick = () => this.toggleAudio();
		this.flashBtn = this.iconButton(right, "zap-off", "Flash off", "lens-flash");
		this.flashBtn.onclick = () => this.cycleFlash();

		// Bottom controls
		const bottom = this.rootEl.createDiv({ cls: "lens-bottom" });

		this.zoomWrapEl = bottom.createDiv({ cls: "lens-zoom" });
		this.zoomLabel = this.zoomWrapEl.createEl("button", { cls: "lens-zoom-label", text: "1.0×" });
		this.zoomLabel.setAttribute("aria-label", "Reset zoom");
		this.zoomLabel.onclick = () => this.setZoom(this.zoomRange().min);
		this.zoomSlider = this.zoomWrapEl.createEl("input", { cls: "lens-zoom-slider", type: "range" });
		this.zoomSlider.addEventListener("input", () => this.setZoom(parseFloat(this.zoomSlider.value)));

		const modes = bottom.createDiv({ cls: "lens-modes" });
		this.photoModeBtn = modes.createEl("button", { cls: "lens-mode", text: "Photo" });
		this.videoModeBtn = modes.createEl("button", { cls: "lens-mode", text: "Video" });
		this.photoModeBtn.onclick = () => this.setMode("photo");
		this.videoModeBtn.onclick = () => this.setMode("video");

		const bar = bottom.createDiv({ cls: "lens-bottombar" });
		this.thumbEl = bar.createDiv({ cls: "lens-thumb" });
		this.countEl = this.thumbEl.createDiv({ cls: "lens-count" });
		this.countEl.hide();
		this.shutterBtn = bar.createEl("button", { cls: "lens-shutter" });
		this.shutterBtn.setAttribute("aria-label", "Take photo");
		this.shutterBtn.createDiv({ cls: "lens-shutter-inner" });
		this.shutterBtn.onclick = () => this.onShutter();
		this.switchBtn = this.iconButton(bar, "switch-camera", "Switch camera", "lens-switch");
		this.switchBtn.onclick = () => this.switchCamera();

		this.setMode("photo");
		this.updateAudioUi();
		this.setControlsEnabled(false);
	}

	private iconButton(parent: HTMLElement, icon: string, label: string, cls: string): HTMLButtonElement {
		const btn = parent.createEl("button", { cls: `lens-icon-btn ${cls}` });
		btn.setAttribute("aria-label", label);
		setIcon(btn, icon);
		return btn;
	}

	private setStatus(text: string | null): void {
		if (text) {
			this.statusEl.setText(text);
			this.statusEl.show();
		} else {
			this.statusEl.hide();
		}
	}

	private setControlsEnabled(enabled: boolean): void {
		this.shutterBtn.disabled = !enabled;
		this.switchBtn.disabled = !enabled || !!this.recorder;
		this.zoomSlider.disabled = !enabled;
	}

	private showError(info: CameraErrorInfo): void {
		this.setStatus(null);
		this.setControlsEnabled(false);
		this.errorEl.empty();
		const card = this.errorEl.createDiv({ cls: "lens-error-card" });
		card.createEl("h3", { text: info.title });
		card.createEl("p", { text: info.message });
		if (info.steps.length) {
			const list = card.createEl("ol");
			for (const step of info.steps) list.createEl("li", { text: step });
		}
		const actions = card.createDiv({ cls: "lens-error-actions" });
		if (info.retryable) {
			const retry = actions.createEl("button", { cls: "mod-cta", text: "Try again" });
			retry.onclick = () => void this.startCamera();
		}
		const close = actions.createEl("button", { text: "Close" });
		close.onclick = () => this.close();
		this.errorEl.show();
	}

	private hideError(): void {
		this.errorEl.hide();
		this.errorEl.empty();
	}

	// ---------------------------------------------------------------- Camera lifecycle

	private startCamera(): Promise<void> {
		if (this.starting) return this.starting;
		this.starting = this.doStartCamera().finally(() => {
			this.starting = null;
		});
		return this.starting;
	}

	private async doStartCamera(): Promise<void> {
		this.hideError();
		this.setStatus("Starting camera…");
		this.setControlsEnabled(false);
		try {
			const stream = await this.controller.start(this.facing, this.settings.videoResolution);
			if (this.closed) {
				this.controller.stop();
				return;
			}
			this.videoEl.srcObject = stream;
			await this.videoEl.play().catch(() => undefined);
			this.applyFeatures();
			this.setStatus(null);
			this.setControlsEnabled(true);
			void this.updateSwitchVisibility();
		} catch (err) {
			if (this.closed) return;
			console.error("Lens: failed to start camera", err);
			this.showError(describeCameraError(err, "camera"));
		}
	}

	private applyFeatures(): void {
		const range = this.zoomRange();
		this.zoomSlider.min = String(range.min);
		this.zoomSlider.max = String(range.max);
		this.zoomSlider.step = String(range.step);
		this.zoomWrapEl.toggle(range.max > range.min);
		this.setZoom(range.min <= 1 && range.max >= 1 ? 1 : range.min);
		this.updateFlashUi();
		if (this.flash === "torch") void this.controller.setTorch(true);
	}

	private async updateSwitchVisibility(): Promise<void> {
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			const cameras = devices.filter((d) => d.kind === "videoinput").length;
			// Keep the button when the count is unknown (labels/ids hidden) — facingMode switching may still work.
			this.switchBtn.toggleClass("is-hidden", cameras === 1);
		} catch {
			this.switchBtn.removeClass("is-hidden");
		}
	}

	private onVisibilityChange = (): void => {
		if (this.closed) return;
		if (document.visibilityState === "hidden") {
			this.suspended = true;
			const stopping = this.recorder ? this.stopRecording() : Promise.resolve();
			void stopping.then(() => {
				if (this.suspended && !this.closed) this.controller.stop();
			});
		} else if (this.suspended) {
			this.suspended = false;
			void this.startCamera();
		}
	};

	private handleTrackEnded(): void {
		if (this.closed || this.suspended) return;
		if (this.recorder) void this.stopRecording();
		this.showError({
			title: "Camera disconnected",
			message: "The camera stopped unexpectedly — another app may have taken it over.",
			steps: ["Close other apps using the camera.", "Tap Try again."],
			retryable: true,
		});
	}

	private switchCamera(): void {
		if (this.recorder || this.starting) return;
		this.facing = this.facing === "environment" ? "user" : "environment";
		void this.startCamera();
	}

	// ---------------------------------------------------------------- Mode / flash / audio

	private setMode(mode: CaptureMode): void {
		if (this.recorder || this.recordingBusy) return;
		this.mode = mode;
		this.rootEl.toggleClass("is-video-mode", mode === "video");
		this.photoModeBtn.toggleClass("is-active", mode === "photo");
		this.videoModeBtn.toggleClass("is-active", mode === "video");
		this.shutterBtn.setAttribute("aria-label", mode === "photo" ? "Take photo" : "Start recording");
		this.audioBtn.toggle(mode === "video");
		this.updateFlashUi();
	}

	private availableFlashModes(): FlashMode[] {
		const f = this.controller.features;
		const modes: FlashMode[] = ["off"];
		if (this.mode === "photo" && (f.photoFlash || f.torch)) modes.push("flash");
		if (f.torch) modes.push("torch");
		return modes;
	}

	private updateFlashUi(): void {
		const modes = this.availableFlashModes();
		if (!modes.includes(this.flash)) {
			if (this.flash === "torch") void this.controller.setTorch(false);
			this.flash = "off";
		}
		this.flashBtn.toggle(modes.length > 1);
		setIcon(this.flashBtn, FLASH_ICONS[this.flash]);
		this.flashBtn.setAttribute("aria-label", FLASH_LABELS[this.flash]);
		this.flashBtn.toggleClass("is-active", this.flash !== "off");
	}

	private cycleFlash(): void {
		const modes = this.availableFlashModes();
		const next = modes[(modes.indexOf(this.flash) + 1) % modes.length];
		const wasTorch = this.flash === "torch";
		this.flash = next;
		if (next === "torch") void this.controller.setTorch(true);
		else if (wasTorch) void this.controller.setTorch(false);
		this.updateFlashUi();
	}

	private toggleAudio(): void {
		if (this.recorder || this.recordingBusy) return;
		this.audioOn = !this.audioOn;
		this.updateAudioUi();
	}

	private updateAudioUi(): void {
		setIcon(this.audioBtn, this.audioOn ? "mic" : "mic-off");
		this.audioBtn.setAttribute("aria-label", this.audioOn ? "Sound on" : "Sound off");
		this.audioBtn.toggleClass("is-off", !this.audioOn);
	}

	// ---------------------------------------------------------------- Zoom

	private zoomRange(): ZoomRange {
		return this.controller.features.hardwareZoom ?? DIGITAL_ZOOM_RANGE;
	}

	private digitalZoom(): number {
		return this.controller.features.hardwareZoom ? 1 : this.zoom;
	}

	private setZoom(value: number): void {
		this.zoom = clampZoom(value, this.zoomRange());
		this.zoomSlider.value = String(this.zoom);
		this.zoomLabel.setText(formatZoom(this.zoom));
		if (this.controller.features.hardwareZoom) void this.controller.setZoom(this.zoom);
		this.applyPreviewTransform();
	}

	private applyPreviewTransform(): void {
		const parts: string[] = [];
		if (this.facing === "user") parts.push("scaleX(-1)");
		const dz = this.digitalZoom();
		if (dz !== 1) parts.push(`scale(${dz})`);
		this.videoEl.style.transform = parts.join(" ");
	}

	// ---------------------------------------------------------------- Gestures

	private onTouchStart = (e: TouchEvent): void => {
		if (e.touches.length === 2) {
			e.preventDefault();
			this.pinch = { distance: touchDistance(e.touches[0], e.touches[1]), zoom: this.zoom };
			this.tap = null;
		} else if (e.touches.length === 1) {
			const t = e.touches[0];
			this.tap = { x: t.clientX, y: t.clientY, time: Date.now() };
		} else {
			this.tap = null;
		}
	};

	private onTouchMove = (e: TouchEvent): void => {
		// Keep Obsidian's sidebar swipe gestures from reacting while the camera is open.
		e.preventDefault();
		if (this.pinch && e.touches.length === 2) {
			const d = touchDistance(e.touches[0], e.touches[1]);
			this.setZoom(pinchZoom(this.pinch.zoom, this.pinch.distance, d, this.zoomRange()));
		}
		if (this.tap && e.touches.length === 1) {
			const t = e.touches[0];
			if (Math.hypot(t.clientX - this.tap.x, t.clientY - this.tap.y) > 12) this.tap = null;
		}
	};

	private onTouchEnd = (e: TouchEvent): void => {
		if (e.touches.length < 2) this.pinch = null;
		if (this.tap && e.touches.length === 0) {
			if (Date.now() - this.tap.time < 400) this.handleTap(this.tap.x, this.tap.y);
			this.tap = null;
		}
	};

	private handleTap(clientX: number, clientY: number): void {
		if (!this.controller.features.tapToFocus) return;
		const box = this.viewportEl.getBoundingClientRect();
		const content = containRect(box.width, box.height, this.videoEl.videoWidth, this.videoEl.videoHeight);
		const lx = clientX - box.left;
		const ly = clientY - box.top;
		const nx = (lx - content.x) / content.width;
		const ny = (ly - content.y) / content.height;
		if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
		const p = viewToFramePoint(nx, ny, this.digitalZoom(), this.facing === "user");
		this.showFocusRing(lx, ly);
		void this.controller.focusAt(p.x, p.y);
	}

	private showFocusRing(x: number, y: number): void {
		const ring = this.focusRingEl;
		ring.style.left = `${x}px`;
		ring.style.top = `${y}px`;
		ring.removeClass("is-visible");
		void ring.offsetWidth; // restart the CSS animation
		ring.addClass("is-visible");
		if (this.focusRingTimer !== null) window.clearTimeout(this.focusRingTimer);
		this.focusRingTimer = window.setTimeout(() => ring.removeClass("is-visible"), 1200);
	}

	// ---------------------------------------------------------------- Capture

	private onShutter(): void {
		if (this.mode === "photo") void this.takePhoto();
		else if (this.recorder) void this.stopRecording();
		else void this.startRecording();
	}

	private flashScreen(): void {
		const el = this.flashOverlayEl;
		el.removeClass("is-active");
		void el.offsetWidth;
		el.addClass("is-active");
	}

	private async takePhoto(): Promise<void> {
		if (this.photoBusy || !this.controller.isActive) return;
		this.photoBusy = true;
		this.shutterBtn.addClass("is-busy");
		const useImageCapture = this.settings.highResPhotos;
		const useFlash = this.flash === "flash";
		const torchAsFlash = useFlash && !this.controller.willUseRealFlash(useImageCapture) && this.controller.features.torch;
		try {
			if (torchAsFlash) {
				await this.controller.setTorch(true);
				await sleep(350);
			}
			this.flashScreen();
			const blob = await this.controller.capturePhoto({
				video: this.videoEl,
				digitalZoom: this.digitalZoom(),
				quality: this.settings.jpegQuality,
				useImageCapture,
				useFlash,
			});
			this.enqueueSave("photo", blob, "image/jpeg");
		} catch (err) {
			console.error("Lens: photo failed", err);
			new Notice(`Lens: couldn't take photo — ${messageOf(err)}`);
		} finally {
			if (torchAsFlash && this.flash !== "torch") await this.controller.setTorch(false);
			// Some devices reset zoom/torch after ImageCapture.takePhoto; re-apply the user's choices.
			if (useImageCapture && this.controller.isActive) {
				if (this.controller.features.hardwareZoom) void this.controller.setZoom(this.zoom);
				if (this.flash === "torch") void this.controller.setTorch(true);
			}
			this.photoBusy = false;
			this.shutterBtn.removeClass("is-busy");
		}
	}

	private async startRecording(): Promise<void> {
		if (this.recorder || this.recordingBusy || !this.controller.isActive) return;
		if (typeof MediaRecorder === "undefined") {
			new Notice("Lens: video recording isn't supported by this Android System WebView.");
			return;
		}
		this.recordingBusy = true;
		this.shutterBtn.disabled = true;
		try {
			const tracks: MediaStreamTrack[] = [];
			if (this.controller.features.hardwareZoom || !this.controller.stream) {
				tracks.push(...(this.controller.stream?.getVideoTracks() ?? []));
			} else {
				// No hardware zoom: record through a canvas so digital zoom ends up in the video.
				this.pipeline = new CanvasZoomPipeline(this.videoEl, () => this.zoom);
				this.pipeline.start();
				tracks.push(...this.pipeline.stream.getVideoTracks());
			}

			if (this.audioOn) {
				try {
					this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
					tracks.push(...this.audioStream.getAudioTracks());
				} catch (err) {
					const info = describeCameraError(err, "microphone");
					new Notice(`Lens: ${info.title} — recording without sound. ${info.steps[0] ?? ""}`, 8000);
				}
			}

			if (this.closed || !this.controller.isActive) {
				this.cleanupRecordingResources();
				return;
			}

			const mime = pickVideoMimeType((t) => MediaRecorder.isTypeSupported(t));
			const recorder = new VideoRecorder(new MediaStream(tracks), mime);
			recorder.start();
			this.recorder = recorder;
			this.recordStartedAt = Date.now();
			this.updateRecordingUi(true);

			const max = this.settings.maxVideoSeconds;
			if (max > 0) this.maxTimer = window.setTimeout(() => void this.stopRecording(), max * 1000);
		} catch (err) {
			console.error("Lens: failed to start recording", err);
			this.cleanupRecordingResources();
			new Notice(`Lens: couldn't start recording — ${messageOf(err)}`);
		} finally {
			this.recordingBusy = false;
			if (!this.closed) this.shutterBtn.disabled = !this.controller.isActive;
		}
	}

	private stopRecording(): Promise<void> {
		if (this.recordingStop) return this.recordingStop;
		const recorder = this.recorder;
		if (!recorder) return Promise.resolve();
		this.recordingStop = (async () => {
			try {
				const blob = await recorder.stop();
				if (blob.size > 0) this.enqueueSave("video", blob, recorder.mimeType);
				else new Notice("Lens: the recording was empty and was not saved.");
			} catch (err) {
				console.error("Lens: recording failed", err);
				new Notice(`Lens: recording failed — ${messageOf(err)}`);
			} finally {
				this.recorder = null;
				this.recordingStop = null;
				this.cleanupRecordingResources();
				if (!this.closed) this.updateRecordingUi(false);
			}
		})();
		return this.recordingStop;
	}

	private cleanupRecordingResources(): void {
		this.pipeline?.stop();
		this.pipeline = null;
		this.audioStream?.getTracks().forEach((t) => t.stop());
		this.audioStream = null;
		this.clearTimers();
	}

	private clearTimers(): void {
		if (this.timerHandle !== null) window.clearInterval(this.timerHandle);
		if (this.maxTimer !== null) window.clearTimeout(this.maxTimer);
		this.timerHandle = null;
		this.maxTimer = null;
	}

	private updateRecordingUi(recording: boolean): void {
		this.rootEl.toggleClass("is-recording", recording);
		this.shutterBtn.setAttribute("aria-label", recording ? "Stop recording" : this.mode === "photo" ? "Take photo" : "Start recording");
		this.switchBtn.disabled = recording;
		this.photoModeBtn.disabled = recording;
		this.videoModeBtn.disabled = recording;
		this.audioBtn.disabled = recording;
		if (recording) {
			const tick = () => this.timerEl.setText(formatDuration((Date.now() - this.recordStartedAt) / 1000));
			tick();
			this.timerEl.show();
			this.timerHandle = window.setInterval(tick, 250);
		} else {
			this.timerEl.hide();
		}
	}

	// ---------------------------------------------------------------- Saving

	private enqueueSave(kind: CaptureKind, blob: Blob, mime: string): void {
		const date = new Date();
		if (!this.closed) this.updateThumbnail(kind, blob);
		this.saveQueue = this.saveQueue.then(async () => {
			try {
				await this.deps.store.saveAndEmbed(this.deps.target, kind, blob, mime, date);
				this.savedCount++;
				if (!this.closed) {
					this.countEl.setText(String(this.savedCount));
					this.countEl.show();
				}
			} catch (err) {
				console.error("Lens: save failed", err);
				new Notice(`Lens: couldn't save ${kind} — ${messageOf(err)}`, 8000);
			}
		});
	}

	private updateThumbnail(kind: CaptureKind, blob: Blob): void {
		if (this.thumbUrl) URL.revokeObjectURL(this.thumbUrl);
		this.thumbUrl = null;
		this.thumbEl.querySelectorAll(".lens-thumb-media").forEach((el) => el.remove());
		const media = createDiv({ cls: "lens-thumb-media" });
		if (kind === "photo") {
			this.thumbUrl = URL.createObjectURL(blob);
			media.createEl("img", { attr: { src: this.thumbUrl, alt: "Last photo" } });
		} else {
			setIcon(media, "film");
		}
		this.thumbEl.prepend(media);
	}
}
