import { describe, expect, it, vi } from "vitest";
import { isUnreadableFileError, readPickedFile } from "../src/storage/readFile";
import { isMediaFile } from "../src/camera/recorder";

function domError(name: string): Error {
	const e = new Error(name);
	e.name = name;
	return e;
}

const noSleep = { sleep: async () => undefined };

describe("reading picked files", () => {
	it("returns the bytes on the first try", async () => {
		const blob = new Blob([new Uint8Array([1, 2, 3])]);
		expect(new Uint8Array(await readPickedFile(blob, noSleep))).toEqual(new Uint8Array([1, 2, 3]));
	});

	it("retries after a transient NotReadableError", async () => {
		const blob = new Blob([new Uint8Array([9])]);
		const real = blob.arrayBuffer.bind(blob);
		const spy = vi.spyOn(blob, "arrayBuffer").mockRejectedValueOnce(domError("NotReadableError")).mockImplementation(real);
		const sleep = vi.fn(async () => undefined);
		expect(new Uint8Array(await readPickedFile(blob, { sleep }))).toEqual(new Uint8Array([9]));
		expect(spy).toHaveBeenCalledTimes(2); // node has no FileReader, so the fallback reader uses arrayBuffer too
		expect(sleep).toHaveBeenCalledTimes(1);
	});

	it("gives up after the configured retries with the last error", async () => {
		const blob = new Blob([new Uint8Array([1])]);
		vi.spyOn(blob, "arrayBuffer").mockRejectedValue(domError("NotReadableError"));
		const sleep = vi.fn(async () => undefined);
		await expect(readPickedFile(blob, { retries: 2, sleep })).rejects.toThrow("NotReadableError");
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it("classifies unreadable-file errors", () => {
		expect(isUnreadableFileError(domError("NotReadableError"))).toBe(true);
		expect(isUnreadableFileError(domError("NotFoundError"))).toBe(true);
		expect(isUnreadableFileError(new Error("disk full"))).toBe(false);
	});
});

describe("media filtering for the file browser", () => {
	it("accepts photos and videos by type or extension", () => {
		expect(isMediaFile("a", "image/png")).toBe(true);
		expect(isMediaFile("clip.MOV", "")).toBe(true);
		expect(isMediaFile("x.jpg", "application/octet-stream")).toBe(true);
	});

	it("rejects other files", () => {
		expect(isMediaFile("notes.pdf", "application/pdf")).toBe(false);
		expect(isMediaFile("README", "")).toBe(false);
	});
});
