import { App, PluginSettingTab, Setting } from "obsidian";
import type LensPlugin from "../main";
import { DEFAULT_SETTINGS, FacingMode, VideoResolution } from "../settings";
import { resolveFolderPath } from "../storage/naming";

export class LensSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: LensPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;

		new Setting(containerEl).setName("Storage").setHeading();

		const folderSetting = new Setting(containerEl)
			.setName("Capture folder")
			.setDesc("")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.folderPattern)
					.setValue(s.folderPattern)
					.onChange(async (value) => {
						s.folderPattern = value.trim() || DEFAULT_SETTINGS.folderPattern;
						updateExample();
						await this.plugin.saveSettings();
					}),
			);
		const updateExample = () => {
			const example = resolveFolderPath("Journal/My note.md", s.folderPattern);
			folderSetting.setDesc(
				`Created next to the note. {{noteName}} is replaced with the note's name; start with / for a vault-root folder. ` +
					`Example for "Journal/My note.md": ${example}/`,
			);
		};
		updateExample();

		new Setting(containerEl).setName("Photos").setHeading();

		new Setting(containerEl)
			.setName("JPEG quality")
			.setDesc("Higher means sharper photos and larger files.")
			.addSlider((slider) =>
				slider
					.setLimits(0.5, 1, 0.05)
					.setValue(s.jpegQuality)
					.setDynamicTooltip()
					.onChange(async (value) => {
						s.jpegQuality = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Full-resolution photos")
			.setDesc("Use the camera's still-photo mode when available. Turn off if taking a photo is slow or fails on your device.")
			.addToggle((toggle) =>
				toggle.setValue(s.highResPhotos).onChange(async (value) => {
					s.highResPhotos = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Video").setHeading();

		new Setting(containerEl)
			.setName("Resolution")
			.setDesc("Preferred camera resolution. Your device may pick the closest one it supports.")
			.addDropdown((dd) =>
				dd
					.addOptions({ "1080p": "1080p (Full HD)", "720p": "720p (HD, smaller files)" })
					.setValue(s.videoResolution)
					.onChange(async (value) => {
						s.videoResolution = value as VideoResolution;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Record sound by default")
			.setDesc("You can still toggle the microphone in the camera before recording.")
			.addToggle((toggle) =>
				toggle.setValue(s.recordAudio).onChange(async (value) => {
					s.recordAudio = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Maximum video length (seconds)")
			.setDesc("Recording stops automatically after this long. 0 means no limit. Long videos use a lot of memory while recording.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "0";
				text
					.setValue(String(s.maxVideoSeconds))
					.onChange(async (value) => {
						const n = Math.max(0, Math.round(Number(value)));
						s.maxVideoSeconds = Number.isFinite(n) ? n : 0;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl).setName("Camera").setHeading();

		new Setting(containerEl)
			.setName("Default camera")
			.addDropdown((dd) =>
				dd
					.addOptions({ environment: "Back", user: "Front (selfie)" })
					.setValue(s.defaultFacing)
					.onChange(async (value) => {
						s.defaultFacing = value as FacingMode;
						await this.plugin.saveSettings();
					}),
			);
	}
}
