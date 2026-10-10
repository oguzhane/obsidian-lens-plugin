import { MarkdownView, Modal, Notice, Platform, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, LensSettings, parseSettings } from "./settings";
import { isCameraAccessBlocked } from "./errors";
import { MediaStore } from "./storage/MediaStore";
import { NoteTarget } from "./storage/NoteTarget";
import { CameraModal } from "./ui/CameraModal";
import { DiagnosticsModal } from "./ui/DiagnosticsModal";
import { LensSettingTab } from "./ui/SettingTab";
import { SystemCaptureModal } from "./ui/SystemCaptureModal";

export default class LensPlugin extends Plugin {
	settings: LensSettings = { ...DEFAULT_SETTINGS };
	private store!: MediaStore;
	private activeModal: Modal | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.store = new MediaStore(this.app, () => this.settings);
		this.addSettingTab(new LensSettingTab(this.app, this));

		this.addCommand({
			id: "open-camera",
			name: "Open camera",
			icon: "camera",
			checkCallback: (checking) => {
				if (!Platform.isAndroidApp) return false;
				if (!checking) this.openCamera();
				return true;
			},
		});

		this.addCommand({
			id: "open-camera-app",
			name: "Add photos or videos (camera app or gallery)",
			icon: "smartphone",
			checkCallback: (checking) => {
				if (!Platform.isAndroidApp) return false;
				if (!checking) this.openCamera("system");
				return true;
			},
		});

		this.addCommand({
			id: "camera-diagnostics",
			name: "Show camera diagnostics",
			icon: "stethoscope",
			checkCallback: (checking) => {
				if (!Platform.isAndroidApp) return false;
				if (!checking) new DiagnosticsModal(this.app, this.manifest.version).open();
				return true;
			},
		});

		if (Platform.isAndroidApp) {
			this.addRibbonIcon("camera", "Open camera", () => this.openCamera());
		}
	}

	onunload(): void {
		this.activeModal?.close();
		this.activeModal = null;
	}

	/** Opens the in-app camera, or the camera-app sheet when the in-app camera is unavailable or not wanted. */
	openCamera(force?: "inApp" | "system"): void {
		if (!Platform.isAndroidApp) {
			new Notice("Lens: the camera is only available in Obsidian for Android.");
			return;
		}
		if (this.activeModal) return;
		const target = this.resolveTarget();
		if (!target) {
			new Notice("Lens: open a note first — photos and videos are embedded into the current note.");
			return;
		}
		const s = this.settings;
		const useSystem = force ? force === "system" : s.cameraMode === "system" || (s.cameraMode === "auto" && s.inAppBlocked);
		if (useSystem) this.openSystemCapture(target);
		else this.openInAppCamera(target);
	}

	private openInAppCamera(target: NoteTarget): void {
		const modal: CameraModal = new CameraModal(this.app, {
			getSettings: () => this.settings,
			store: this.store,
			target,
			onCameraUnavailable: (err) => {
				if (this.settings.cameraMode !== "auto" || !isCameraAccessBlocked(err)) return false;
				// Obsidian for Android doesn't hold the camera permission, so fall back to the phone's camera app.
				this.settings.inAppBlocked = true;
				void this.saveSettings();
				modal.close();
				new Notice("Lens: Obsidian can't access the camera directly on this device — using your camera app instead.", 6000);
				this.openSystemCapture(target);
				return true;
			},
			onUseSystemCamera: () => this.openSystemCapture(target),
			onClosed: () => {
				if (this.activeModal === modal) this.activeModal = null;
			},
		});
		this.activeModal = modal;
		modal.open();
	}

	private openSystemCapture(target: NoteTarget): void {
		const showRetry = this.settings.cameraMode === "auto" && this.settings.inAppBlocked;
		const modal: SystemCaptureModal = new SystemCaptureModal(this.app, {
			store: this.store,
			target,
			onTryInApp: showRetry
				? () => {
						this.settings.inAppBlocked = false;
						void this.saveSettings();
						this.openInAppCamera(target);
					}
				: undefined,
			onClosed: () => {
				if (this.activeModal === modal) this.activeModal = null;
			},
		});
		this.activeModal = modal;
		modal.open();
	}

	private resolveTarget(): NoteTarget | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file) return new NoteTarget(this.app, view.file, view);
		const file = this.app.workspace.getActiveFile();
		if (file instanceof TFile && file.extension === "md") return new NoteTarget(this.app, file, null);
		return null;
	}

	async loadSettings(): Promise<void> {
		this.settings = parseSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
