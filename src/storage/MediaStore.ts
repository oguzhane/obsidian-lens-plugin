import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { LensSettings } from "../settings";
import { extensionForMime } from "../camera/recorder";
import { CaptureKind, buildBaseName, resolveFolderPath, toEmbed, uniqueFilePath } from "./naming";

export interface InsertTarget {
	readonly file: TFile;
	insert(embed: string): Promise<void>;
}

/** Saves captured media into the vault and embeds it into the target note. */
export class MediaStore {
	constructor(private app: App, private getSettings: () => LensSettings) {}

	folderFor(notePath: string): string {
		return normalizePath(resolveFolderPath(notePath, this.getSettings().folderPattern));
	}

	async ensureFolder(path: string): Promise<void> {
		if (!path) return;
		const vault = this.app.vault;
		const parts = path.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const existing = vault.getAbstractFileByPath(current);
			if (existing instanceof TFolder) continue;
			if (existing) throw new Error(`"${current}" exists and is not a folder`);
			try {
				await vault.createFolder(current);
			} catch (err) {
				// Another save may have created it concurrently.
				if (!(vault.getAbstractFileByPath(current) instanceof TFolder)) throw err;
			}
		}
	}

	/** Writes the data to `<folder>/<IMG|VID>_<timestamp>.<ext>` and returns the new file. */
	async save(notePath: string, kind: CaptureKind, data: Blob | ArrayBuffer, mime: string, date = new Date()): Promise<TFile> {
		const folder = this.folderFor(notePath);
		await this.ensureFolder(folder);
		const blobType = data instanceof ArrayBuffer ? "" : data.type;
		const ext = extensionForMime(mime || blobType || (kind === "photo" ? "image/jpeg" : "video/webm"));
		const path = uniqueFilePath(folder, buildBaseName(kind, date), ext, (p) => !!this.app.vault.getAbstractFileByPath(p));
		const bytes = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
		return this.app.vault.createBinary(path, bytes);
	}

	/** Saves the capture and inserts an embed (respecting the user's link-format settings) into the note. */
	async saveAndEmbed(target: InsertTarget, kind: CaptureKind, data: Blob | ArrayBuffer, mime: string, date = new Date()): Promise<TFile> {
		const file = await this.save(target.file.path, kind, data, mime, date);
		const link = this.app.fileManager.generateMarkdownLink(file, target.file.path);
		await target.insert(toEmbed(link));
		return file;
	}
}
