/** Minimal stand-ins for the parts of the Obsidian API used by unit-tested modules. */

export class TAbstractFile {
	constructor(public path: string) {}
	get name(): string {
		return this.path.slice(this.path.lastIndexOf("/") + 1);
	}
}

export class TFile extends TAbstractFile {
	get basename(): string {
		return this.name.replace(/\.[^.]+$/, "");
	}
	get extension(): string {
		const dot = this.name.lastIndexOf(".");
		return dot >= 0 ? this.name.slice(dot + 1) : "";
	}
}

export class TFolder extends TAbstractFile {}

export function normalizePath(path: string): string {
	return path
		.replace(/[\\/]+/g, "/")
		.replace(/^\/+|\/+$/g, "")
		|| "/";
}

export class FakeVault {
	files = new Map<string, TAbstractFile>();
	binaries = new Map<string, ArrayBuffer>();
	texts = new Map<string, string>();
	createdFolders: string[] = [];

	getAbstractFileByPath(path: string): TAbstractFile | null {
		return this.files.get(path) ?? null;
	}

	async createFolder(path: string): Promise<TFolder> {
		if (this.files.has(path)) throw new Error("Folder already exists.");
		const folder = new TFolder(path);
		this.files.set(path, folder);
		this.createdFolders.push(path);
		return folder;
	}

	async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
		if (this.files.has(path)) throw new Error("File already exists.");
		const file = new TFile(path);
		this.files.set(path, file);
		this.binaries.set(path, data);
		return file;
	}

	async process(file: TFile, fn: (data: string) => string): Promise<string> {
		const next = fn(this.texts.get(file.path) ?? "");
		this.texts.set(file.path, next);
		return next;
	}
}

export class FakeFileManager {
	useWikilinks = true;
	generateMarkdownLink(file: TFile, _sourcePath: string): string {
		return this.useWikilinks ? `[[${file.name}]]` : `![](${encodeURI(file.path)})`;
	}
}

export class App {
	vault = new FakeVault();
	fileManager = new FakeFileManager();
}
