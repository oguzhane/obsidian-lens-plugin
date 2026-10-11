import { App, Modal, Notice, setIcon } from "obsidian";
import { captureKindForFile, isMediaFile, mimeForCapturedFile } from "../camera/recorder";
import type { MediaStore } from "../storage/MediaStore";
import type { NoteTarget } from "../storage/NoteTarget";
import type { CaptureKind } from "../storage/naming";
import { isUnreadableFileError, readPickedFile } from "../storage/readFile";

export interface SystemCaptureDeps {
	store: MediaStore;
	target: NoteTarget;
	/** Shown as a link when the user may want to retry the in-app camera. */
	onTryInApp?: () => void;
	onClosed?: () => void;
}

interface Batch {
	remaining: number;
	unreadable: string[];
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Captures through the phone's own camera app (file input with `capture`) or imports several
 * photos/videos from the gallery or file browser. Works even when Obsidian has no camera
 * permission, because the camera app / system picker does the capturing.
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
		const galleryInput = this.createMultiInput("image/*,video/*");
		// No accept filter → Android opens its file browser instead of the photo picker. It grants file
		// access differently, which helps with items the photo picker won't let Obsidian read.
		const browseInput = this.createMultiInput("");

		const actions = contentEl.createDiv({ cls: "lens-sheet-actions" });
		this.actionButton(actions, "camera", "Take photo", () => photoInput.click());
		this.actionButton(actions, "video", "Record video", () => videoInput.click());
		this.actionButton(actions, "images", "Choose from gallery", () => galleryInput.click(), "lens-sheet-action-wide");
		this.actionButton(actions, "folder-open", "Browse files", () => browseInput.click(), "lens-sheet-action-wide lens-sheet-action-secondary");

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
		if (accept) input.accept = accept;
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
			if (file) this.importFiles([file], () => kind, () => new Date());
		});
		return input;
	}

	private createMultiInput(accept: string): HTMLInputElement {
		const input = this.hiddenInput(accept);
		input.multiple = true;
		input.addEventListener("change", () => {
			const all = Array.from(input.files ?? []);
			input.value = "";
			const media = all.filter((f) => isMediaFile(f.name, f.type));
			const skipped = all.length - media.length;
			if (skipped > 0) {
				new Notice(`Lens: skipped ${skipped === 1 ? "1 file that isn't a photo or video" : `${skipped} files that aren't photos or videos`}.`);
			}
			const importedAt = new Date();
			this.importFiles(
				media,
				(f) => captureKindForFile(f.name, f.type),
				// Name gallery items after when they were taken when the picker reports it.
				(f) => (f.lastModified > 0 ? new Date(f.lastModified) : importedAt),
			);
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

	/**
	 * Reads every picked file right away (Android's temporary access to picked files can lapse),
	 * then saves them one by one so embeds land in the note in the order they were picked.
	 */
	private importFiles(files: File[], kindOf: (f: File) => CaptureKind, dateOf: (f: File) => Date): void {
		if (files.length === 0) return;
		const batch: Batch = { remaining: files.length, unreadable: [] };

		let readChain: Promise<unknown> = Promise.resolve();
		const reads = files.map((file) => {
			const read = readChain.then(() => readPickedFile(file));
			readChain = read.catch(() => undefined);
			read.catch(() => undefined); // handled when the save step awaits it
			return read;
		});

		files.forEach((file, i) => {
			const kind = kindOf(file);
			const mime = mimeForCapturedFile(file.name, file.type, kind);
			const date = dateOf(file);
			this.pending++;
			this.saveQueue = this.saveQueue.then(async () => {
				try {
					const bytes = await reads[i];
					await this.deps.store.saveAndEmbed(this.deps.target, kind, bytes, mime, date);
					this.savedCount++;
				} catch (err) {
					console.error(`Lens: couldn't import ${file.name} (${file.type || "unknown type"}, ${file.size} bytes)`, err);
					if (isUnreadableFileError(err)) batch.unreadable.push(file.name || kind);
					else new Notice(`Lens: couldn't save ${file.name || kind} — ${errorMessage(err)}`, 8000);
				} finally {
					this.pending--;
					batch.remaining--;
					this.updateStatus();
					if (batch.remaining === 0) this.reportUnreadable(batch, files.length);
				}
			});
		});
		this.updateStatus();
	}

	private reportUnreadable(batch: Batch, total: number): void {
		const n = batch.unreadable.length;
		if (n === 0) return;
		const names = batch.unreadable.slice(0, 3).join(", ") + (n > 3 ? ` and ${n - 3} more` : "");
		new Notice(
			`Lens: Android didn't let Obsidian read ${n} of ${total} file${total === 1 ? "" : "s"} (${names}). ` +
				`Try adding them again with “Browse files”, or one at a time.`,
			12000,
		);
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
