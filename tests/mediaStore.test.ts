import { describe, expect, it } from "vitest";
import { App, TFile, TFolder } from "obsidian";
import { MediaStore, InsertTarget } from "../src/storage/MediaStore";
import { DEFAULT_SETTINGS, LensSettings } from "../src/settings";

function setup(settings: Partial<LensSettings> = {}) {
	const app = new App();
	const s = { ...DEFAULT_SETTINGS, ...settings };
	const store = new MediaStore(app as never, () => s);
	const inserted: string[] = [];
	const note = new TFile("Journal/Trip.md");
	const target: InsertTarget = { file: note as never, insert: async (e) => void inserted.push(e) };
	return { app, store, target, inserted };
}

const date = new Date(2026, 9, 10, 8, 30, 0);
const blob = (type: string) => new Blob([new Uint8Array([1, 2, 3])], { type });

describe("MediaStore", () => {
	it("saves photos into <note>.assets and embeds them", async () => {
		const { app, store, target, inserted } = setup();
		const file = await store.saveAndEmbed(target, "photo", blob("image/jpeg"), "image/jpeg", date);
		expect(file.path).toBe("Journal/Trip.assets/IMG_20261010_083000.jpg");
		expect(app.vault.createdFolders).toEqual(["Journal", "Journal/Trip.assets"]);
		expect(new Uint8Array(app.vault.binaries.get(file.path)!)).toEqual(new Uint8Array([1, 2, 3]));
		expect(inserted).toEqual(["![[IMG_20261010_083000.jpg]]"]);
	});

	it("saves videos with the recorded container extension", async () => {
		const { store, target } = setup();
		const mp4 = await store.saveAndEmbed(target, "video", blob("video/mp4"), "video/mp4;codecs=avc1,mp4a.40.2", date);
		const webm = await store.saveAndEmbed(target, "video", blob("video/webm"), "video/webm;codecs=vp9,opus", date);
		expect(mp4.path).toBe("Journal/Trip.assets/VID_20261010_083000.mp4");
		expect(webm.path).toBe("Journal/Trip.assets/VID_20261010_083000.webm");
	});

	it("does not overwrite burst shots taken in the same second", async () => {
		const { store, target, inserted } = setup();
		await store.saveAndEmbed(target, "photo", blob("image/jpeg"), "image/jpeg", date);
		const second = await store.saveAndEmbed(target, "photo", blob("image/jpeg"), "image/jpeg", date);
		expect(second.path).toBe("Journal/Trip.assets/IMG_20261010_083000_1.jpg");
		expect(inserted).toHaveLength(2);
	});

	it("reuses existing folders and respects markdown-link settings", async () => {
		const { app, store, target, inserted } = setup();
		app.vault.files.set("Journal", new TFolder("Journal"));
		app.vault.files.set("Journal/Trip.assets", new TFolder("Journal/Trip.assets"));
		app.fileManager.useWikilinks = false;
		await store.saveAndEmbed(target, "photo", blob("image/jpeg"), "image/jpeg", date);
		expect(app.vault.createdFolders).toEqual([]);
		expect(inserted).toEqual(["![](Journal/Trip.assets/IMG_20261010_083000.jpg)"]);
	});

	it("refuses to write when a file blocks the folder path", async () => {
		const { app, store, target } = setup();
		app.vault.files.set("Journal", new TFolder("Journal"));
		app.vault.files.set("Journal/Trip.assets", new TFile("Journal/Trip.assets"));
		await expect(store.saveAndEmbed(target, "photo", blob("image/jpeg"), "image/jpeg", date)).rejects.toThrow(/not a folder/);
	});

	it("accepts raw bytes read from picked files", async () => {
		const { app, store, target } = setup();
		const file = await store.saveAndEmbed(target, "video", new Uint8Array([7, 8]).buffer, "video/quicktime", date);
		expect(file.path).toBe("Journal/Trip.assets/VID_20261010_083000.mov");
		expect(new Uint8Array(app.vault.binaries.get(file.path)!)).toEqual(new Uint8Array([7, 8]));
	});

	it("honours a custom folder pattern", async () => {
		const { store, target } = setup({ folderPattern: "/Media/{{noteName}}" });
		const file = await store.saveAndEmbed(target, "photo", blob("image/jpeg"), "image/jpeg", date);
		expect(file.path).toBe("Media/Trip/IMG_20261010_083000.jpg");
	});
});
