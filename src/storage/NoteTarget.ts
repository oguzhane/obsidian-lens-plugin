import type { App, MarkdownView, TFile } from "obsidian";
import { appendEmbed, buildEmbedInsertion } from "./naming";

/** The note a camera session inserts into, captured when the camera was opened. */
export class NoteTarget {
	constructor(private app: App, readonly file: TFile, private view: MarkdownView | null) {}

	/** Inserts at the editor cursor if the note is still open in edit mode, otherwise appends to the file. */
	async insert(embed: string): Promise<void> {
		const view = this.view;
		const stillOpen = !!view && view.file?.path === this.file.path && view.leaf?.view === view && view.getMode() === "source";
		if (stillOpen && view) {
			const editor = view.editor;
			const cursor = editor.getCursor();
			const before = editor.getLine(cursor.line).slice(0, cursor.ch);
			editor.replaceSelection(buildEmbedInsertion(embed, before));
			return;
		}
		await this.app.vault.process(this.file, (data) => appendEmbed(data, embed));
	}
}
