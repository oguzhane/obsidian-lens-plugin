export interface CameraErrorInfo {
	title: string;
	message: string;
	steps: string[];
	retryable: boolean;
}

export type DeviceKind = "camera" | "microphone";

function errorName(err: unknown): string {
	if (err && typeof err === "object" && "name" in err && typeof (err as { name: unknown }).name === "string") {
		return (err as { name: string }).name;
	}
	return "";
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
	return typeof err === "string" ? err : "";
}

function mediaDevicesAvailable(): boolean {
	return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

/** True when the error means plugins can't use the camera at all (permission missing/denied or API absent). */
export function isCameraAccessBlocked(err: unknown): boolean {
	const name = errorName(err);
	if (["NotAllowedError", "PermissionDeniedError", "SecurityError", "UnsupportedError"].includes(name)) return true;
	return !mediaDevicesAvailable();
}

/** Maps getUserMedia / MediaRecorder failures to user-facing guidance. */
export function describeCameraError(err: unknown, kind: DeviceKind = "camera"): CameraErrorInfo {
	const name = errorName(err);
	const device = kind === "camera" ? "Camera" : "Microphone";
	const lower = device.toLowerCase();

	switch (name) {
		case "NotAllowedError":
		case "PermissionDeniedError":
		case "SecurityError":
			return {
				title: `${device} permission needed`,
				message: `Obsidian isn't allowed to use the ${lower}.`,
				steps: [
					"Open Android Settings → Apps → Obsidian → Permissions.",
					kind === "camera"
						? "Set Camera to \"Allow only while using the app\" (and Microphone too, for video sound)."
						: "Set Microphone to \"Allow only while using the app\".",
					"Come back to Obsidian and tap Try again. If it still fails, fully close and reopen Obsidian.",
					...(kind === "camera"
						? ["If Camera isn't listed there, this Obsidian version can't give plugins camera access — tap \"Use camera app\" instead."]
						: []),
				],
				retryable: true,
			};
		case "NotFoundError":
		case "DevicesNotFoundError":
		case "OverconstrainedError":
		case "ConstraintNotSatisfiedError":
			return {
				title: `No ${lower} found`,
				message: `This device didn't report a usable ${lower}.`,
				steps: ["Try switching between front and back camera.", "Lower the video resolution in Lens settings and try again."],
				retryable: true,
			};
		case "NotReadableError":
		case "TrackStartError":
		case "AbortError":
			return {
				title: `${device} is busy`,
				message: `Android couldn't start the ${lower}; another app may be using it.`,
				steps: [`Close other apps that use the ${lower} (camera, video calls, screen recorders).`, "Tap Try again."],
				retryable: true,
			};
		case "UnsupportedError":
			return unsupported();
		default: {
			if (!mediaDevicesAvailable()) return unsupported();
			const msg = errorMessage(err);
			return {
				title: `Couldn't start the ${lower}`,
				message: msg ? `${name ? name + ": " : ""}${msg}` : "An unknown error occurred.",
				steps: ["Tap Try again.", "If it keeps failing, run \"Lens: Show camera diagnostics\" and include the output in a bug report."],
				retryable: true,
			};
		}
	}
}

function unsupported(): CameraErrorInfo {
	return {
		title: "Camera not available",
		message: "This Obsidian / Android System WebView build doesn't expose the camera to plugins.",
		steps: [
			"Update Obsidian from the Play Store.",
			"Update \"Android System WebView\" (or Chrome) from the Play Store.",
			"Restart Obsidian and try again.",
		],
		retryable: false,
	};
}
