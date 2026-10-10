import { App, Modal, Notice, setIcon } from "obsidian";
import { mimeForCapturedFile } from "../camera/recorder";
import type { MediaStore } from "../storage/MediaStore";
import type { NoteTarget } from "../storage/NoteTarget";
import type { CaptureKind } from "../storage/naming";

export interface SystemCaptureDeps {
	store: MediaStore;
	target: NoteTarget;
	/** Shown as a link when the user may want to retry the in-app camera. */
	onTryInApp?: () => void;
	onClosed?: () => void;
}

/**
 * Captures through the phone's own camera app (file input with `capture`).
 * Works even when Obsidian has no camera permission, because the camera app takes the picture.
 * Zoom, flash, focus and lens switching are provided by the camera app itself.
 */
export class SystemCaptureModal extends Modal {
	private saveQueue: Promise<void> = Promise.resolve();
	private savedCount = 0;
	private pending = 0;
	private statusEl!: HTMLElement;

	constructor(app: App, private deps: SystemCaptureDeps) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("lens-sheet");
		this.titleEl.setText("Add photo or video");
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("p", {
			cls: "lens-sheet-hint",
			text: `Opens your phone's camera app, where you can zoom, use the flash and switch cameras. Each capture is added to “${this.deps.target.file.basename}”.`,
		});

		const photoInput = this.createInput("image/*", "photo");
		const videoInput = this.createInput("video/*", "video");

		const actions = contentEl.createDiv({ cls: "lens-sheet-actions" });
		this.actionButton(actions, "camera", "Take photo", () => photoInput.click());
		this.actionButton(actions, "video", "Record video", () => videoInput.click());

		this.statusEl = contentEl.createDiv({ cls: "lens-sheet-status" });
		this.updateStatus();

		const footer = contentEl.createDiv({ cls: "lens-sheet-footer" });
		if (this.deps.onTryInApp) {
			const retry = footer.createEl("button", { cls: "lens-sheet-link", text: "Try in-app camera" });
			retry.onclick = () => {
				const cb = this.deps.onTryInApp;
				this.close();
				cb?.();
			};
		}
		const done = footer.createEl("button", { cls: "mod-cta", text: "Done" });
		done.onclick = () => this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		void this.saveQueue.then(() => {
			if (this.savedCount > 0) {
				const n = this.savedCount;
				new Notice(`Lens: added ${n} capture${n === 1 ? "" : "s"} to ${this.deps.target.file.basename}`);
			}
		});
		this.deps.onClosed?.();
	}

	private createInput(accept: string, kind: CaptureKind): HTMLInputElement {
		const input = this.contentEl.createEl("input", { type: "file" });
		input.accept = accept;
		// A single accept type plus `capture` makes Android launch the camera app instead of the file picker.
		input.setAttribute("capture", "environment");
		input.addClass("lens-hidden-input");
		input.addEventListener("change", () => {
			const file = input.files?.[0];
			input.value = "";
			if (file) this.enqueueSave(kind, file);
		});
		return input;
	}

	private actionButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
		const btn = parent.createEl("button", { cls: "lens-sheet-action" });
		const iconEl = btn.createDiv({ cls: "lens-sheet-action-icon" });
		setIcon(iconEl, icon);
		btn.createDiv({ cls: "lens-sheet-action-label", text: label });
		btn.onclick = onClick;
	}

	private enqueueSave(kind: CaptureKind, file: File): void {
		this.pending++;
		this.updateStatus();
		const mime = mimeForCapturedFile(file.name, file.type, kind);
		this.saveQueue = this.saveQueue.then(async () => {
			try {
				await this.deps.store.saveAndEmbed(this.deps.target, kind, file, mime);
				this.savedCount++;
			} catch (err) {
				console.error("Lens: save failed", err);
				new Notice(`Lens: couldn't save ${kind} — ${err instanceof Error ? err.message : String(err)}`, 8000);
			} finally {
				this.pending--;
				this.updateStatus();
			}
		});
	}

	private updateStatus(): void {
		if (!this.statusEl) return;
		const parts: string[] = [];
		if (this.savedCount > 0) parts.push(`${this.savedCount} added`);
		if (this.pending > 0) parts.push("saving…");
		this.statusEl.setText(parts.join(" · "));
		this.statusEl.toggle(parts.length > 0);
	}
}
