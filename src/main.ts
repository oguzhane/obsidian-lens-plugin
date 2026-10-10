import { MarkdownView, Notice, Platform, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, LensSettings, parseSettings } from "./settings";
import { MediaStore } from "./storage/MediaStore";
import { NoteTarget } from "./storage/NoteTarget";
import { CameraModal } from "./ui/CameraModal";
import { DiagnosticsModal } from "./ui/DiagnosticsModal";
import { LensSettingTab } from "./ui/SettingTab";

export default class LensPlugin extends Plugin {
	settings: LensSettings = { ...DEFAULT_SETTINGS };
	private store!: MediaStore;
	private activeModal: CameraModal | null = null;

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

	openCamera(): void {
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
		const modal = new CameraModal(this.app, {
			getSettings: () => this.settings,
			store: this.store,
			target,
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
