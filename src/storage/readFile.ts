/**
 * Reads a picked file into memory. Android hands WebViews temporary content-URI grants for picked
 * files; reading can fail with NotReadableError, sometimes transiently, so retry with a
 * different reader after a short pause before giving up.
 */
export async function readPickedFile(
	file: Blob,
	opts: { retries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ArrayBuffer> {
	const retries = opts.retries ?? 2;
	const delayMs = opts.delayMs ?? 400;
	const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const readers: Array<() => Promise<ArrayBuffer>> = [() => file.arrayBuffer(), () => readWithFileReader(file)];

	let lastError: unknown = null;
	for (let attempt = 0; attempt <= retries; attempt++) {
		if (attempt > 0) await sleep(delayMs * attempt);
		try {
			return await readers[attempt % readers.length]();
		} catch (err) {
			lastError = err;
		}
	}
	throw lastError ?? new Error("Could not read file");
}

function readWithFileReader(file: Blob): Promise<ArrayBuffer> {
	if (typeof FileReader === "undefined") return file.arrayBuffer();
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as ArrayBuffer);
		reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
		reader.readAsArrayBuffer(file);
	});
}

/** True for errors meaning Android revoked/never granted read access to a picked file. */
export function isUnreadableFileError(err: unknown): boolean {
	const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
	return name === "NotReadableError" || name === "NotFoundError" || name === "SecurityError";
}
