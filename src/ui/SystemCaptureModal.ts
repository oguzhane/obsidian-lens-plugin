import { App, Modal, Notice, setIcon } from "obsidian";
import { captureKindForFile, mimeForCapturedFile } from "../camera/recorder";
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
 * Captures through the phone's own camera app (file input with `capture`) or imports several
 * photos/videos from the gallery at once. Works even when Obsidian has no camera permission,
 * because the camera app / system picker does the capturing.
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
		this.titleEl.setText("Add photos or videos");
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("p", {
			cls: "lens-sheet-hint",
			text:
				`Take a photo or video with your phone's camera app, or pick several from your gallery. ` +
				`Everything is added to “${this.deps.target.file.basename}”.`,
		});

		const photoInput = this.createCaptureInput("image/*", "photo");
		const videoInput = this.createCaptureInput("video/*", "video");
		const galleryInput = this.createGalleryInput();

		const actions = contentEl.createDiv({ cls: "lens-sheet-actions" });
		this.actionButton(actions, "camera", "Take photo", () => photoInput.click());
		this.actionButton(actions, "video", "Record video", () => videoInput.click());
		this.actionButton(actions, "images", "Choose from gallery", () => galleryInput.click(), "lens-sheet-action-wide");

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
				new Notice(`Lens: added ${n} item${n === 1 ? "" : "s"} to ${this.deps.target.file.basename}`);
			}
		});
		this.deps.onClosed?.();
	}

	private hiddenInput(accept: string): HTMLInputElement {
		const input = this.contentEl.createEl("input", { type: "file" });
		input.accept = accept;
		input.addClass("lens-hidden-input");
		return input;
	}

	private createCaptureInput(accept: string, kind: CaptureKind): HTMLInputElement {
		const input = this.hiddenInput(accept);
		// A single accept type plus `capture` makes Android launch the camera app instead of the file picker.
		input.setAttribute("capture", "environment");
		input.addEventListener("change", () => {
			const file = input.files?.[0];
			input.value = "";
			if (file) this.enqueueSave(kind, file, new Date());
		});
		return input;
	}

	private createGalleryInput(): HTMLInputElement {
		const input = this.hiddenInput("image/*,video/*");
		input.multiple = true;
		input.addEventListener("change", () => {
			const files = Array.from(input.files ?? []);
			input.value = "";
			const importedAt = new Date();
			for (const file of files) {
				const kind = captureKindForFile(file.name, file.type);
				// Name gallery items after when they were taken when the picker reports it.
				const date = file.lastModified > 0 ? new Date(file.lastModified) : importedAt;
				this.enqueueSave(kind, file, date);
			}
		});
		return input;
	}

	private actionButton(parent: HTMLElement, icon: string, label: string, onClick: () => void, extraCls = ""): void {
		const btn = parent.createEl("button", { cls: `lens-sheet-action ${extraCls}`.trim() });
		const iconEl = btn.createDiv({ cls: "lens-sheet-action-icon" });
		setIcon(iconEl, icon);
		btn.createDiv({ cls: "lens-sheet-action-label", text: label });
		btn.onclick = onClick;
	}

	/** Saves sequentially so embeds land in the note in the same order the files were picked. */
	private enqueueSave(kind: CaptureKind, file: File, date: Date): void {
		this.pending++;
		this.updateStatus();
		const mime = mimeForCapturedFile(file.name, file.type, kind);
		this.saveQueue = this.saveQueue.then(async () => {
			try {
				await this.deps.store.saveAndEmbed(this.deps.target, kind, file, mime, date);
				this.savedCount++;
			} catch (err) {
				console.error("Lens: save failed", err);
				new Notice(`Lens: couldn't save ${file.name || kind} — ${err instanceof Error ? err.message : String(err)}`, 8000);
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
		if (this.pending > 0) parts.push(this.pending === 1 ? "saving…" : `saving ${this.pending}…`);
		this.statusEl.setText(parts.join(" · "));
		this.statusEl.toggle(parts.length > 0);
	}
}
