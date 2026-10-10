import { App, Modal, Notice, Platform } from "obsidian";
import { getImageCaptureCtor, getSupportedConstraints, getTrackCapabilities } from "../camera/mediaTypes";
import { VIDEO_MIME_PREFERENCES } from "../camera/recorder";
import type { FacingMode } from "../settings";

/**
 * Reports what this device's WebView exposes (camera access, zoom/torch/focus,
 * ImageCapture, recording formats) so feature support can be checked on a real phone.
 */
export class DiagnosticsModal extends Modal {
	private output = "";
	private preEl!: HTMLElement;

	constructor(app: App, private pluginVersion: string) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("lens-diagnostics");
		this.titleEl.setText("Lens camera diagnostics");
		const { contentEl } = this;
		contentEl.createEl("p", {
			text: "Checks what the camera exposes to plugins on this device. The camera turns on briefly.",
		});
		this.preEl = contentEl.createEl("pre", { cls: "lens-diagnostics-output", text: "Collecting…" });
		const actions = contentEl.createDiv({ cls: "lens-diagnostics-actions" });
		const copy = actions.createEl("button", { cls: "mod-cta", text: "Copy" });
		copy.onclick = async () => {
			try {
				await navigator.clipboard.writeText(this.output);
				new Notice("Diagnostics copied");
			} catch {
				new Notice("Couldn't copy — select the text manually");
			}
		};
		actions.createEl("button", { text: "Close" }).onclick = () => this.close();
		void this.collect();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private log(line: string): void {
		this.output += `${line}\n`;
		this.preEl.setText(this.output);
	}

	private async collect(): Promise<void> {
		this.output = "";
		this.log(`Lens ${this.pluginVersion}`);
		this.log(`User agent: ${navigator.userAgent}`);
		this.log(`Platform: android=${Platform.isAndroidApp} mobile=${Platform.isMobile}`);

		const md = navigator.mediaDevices;
		this.log(`mediaDevices.getUserMedia: ${typeof md?.getUserMedia === "function"}`);
		this.log(`ImageCapture API: ${!!getImageCaptureCtor()}`);
		const hasRecorder = typeof MediaRecorder !== "undefined";
		this.log(`MediaRecorder: ${hasRecorder}`);
		if (hasRecorder) {
			for (const type of VIDEO_MIME_PREFERENCES) this.log(`  ${MediaRecorder.isTypeSupported(type) ? "✓" : "✗"} ${type}`);
		}
		const supported = getSupportedConstraints();
		const keys = ["zoom", "torch", "focusMode", "pointsOfInterest", "facingMode"] as const;
		this.log(`Supported constraints: ${keys.map((k) => `${k}=${supported[k] === true}`).join(" ")}`);

		if (typeof md?.getUserMedia !== "function") {
			this.log("\nCamera API not available — nothing more to test.");
			return;
		}

		for (const facing of ["environment", "user"] as FacingMode[]) {
			await this.probeCamera(facing, supported.zoom === true);
		}

		try {
			const devices = await md.enumerateDevices();
			this.log(`\nDevices (${devices.length}):`);
			for (const d of devices) this.log(`  ${d.kind}: ${d.label || "(no label)"}`);
		} catch (err) {
			this.log(`enumerateDevices failed: ${String(err)}`);
		}
		this.log("\nDone.");
	}

	private async probeCamera(facing: FacingMode, requestZoom: boolean): Promise<void> {
		this.log(`\n[${facing} camera]`);
		let stream: MediaStream | null = null;
		try {
			const video: MediaTrackConstraints & { zoom?: boolean } = { facingMode: { ideal: facing } };
			if (requestZoom) video.zoom = true;
			stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
			const track = stream.getVideoTracks()[0];
			this.log(`  label: ${track.label}`);
			this.log(`  settings: ${JSON.stringify(track.getSettings())}`);
			this.log(`  capabilities: ${JSON.stringify(getTrackCapabilities(track))}`);
			const Ctor = getImageCaptureCtor();
			if (Ctor) {
				try {
					const caps = await new Ctor(track).getPhotoCapabilities();
					this.log(`  photoCapabilities: ${JSON.stringify(caps)}`);
				} catch (err) {
					this.log(`  getPhotoCapabilities failed: ${String(err)}`);
				}
			}
		} catch (err) {
			const e = err as { name?: string; message?: string };
			this.log(`  getUserMedia failed: ${e?.name ?? ""} ${e?.message ?? String(err)}`);
		} finally {
			stream?.getTracks().forEach((t) => t.stop());
		}
	}
}
