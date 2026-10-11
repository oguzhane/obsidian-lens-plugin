# Lens — in-app camera for Obsidian Android

Take photos and record videos **without leaving Obsidian**. Tap the camera button and a full-screen
camera opens. Every photo or video you take is saved to your vault and embedded at the cursor in the
current note. The camera stays open, so you can capture several in a row.

> **Platform:** Obsidian for **Android** only. The commands are hidden on desktop and iOS.

> **Camera access on Android:** the Obsidian Android app currently doesn't hold Android's *Camera* permission,
> so plugins can't use the camera directly (Camera won't appear under Obsidian's app permissions).
> In **Automatic** mode (the default), Lens notices this the first time and switches to your **phone's camera app**.
> You still tap one button, take the photo or video with your normal camera (zoom, flash, focus and lens switching included),
> and it's saved and embedded in your note. If a future Obsidian version grants camera access, the in-app camera below
> works automatically. Use *Try in-app camera* in the capture sheet to check again.

## Capture modes

| Mode | How it works |
|---|---|
| **Phone camera app** | Opens your camera app for each photo or video. Works on every Android device; uses your camera app's own zoom, flash, focus and video features. |
| **Gallery (multi-select)** | Pick several existing photos and videos at once. They're copied into the capture folder and embedded in the order you picked them, named after the date they were taken. **Browse files** does the same through Android's file browser. |
| **In-app camera** | A full-screen camera inside Obsidian with the controls below. Requires Obsidian to have camera permission. |

Choose a mode in **Settings → Lens → Camera**. You can also run **Lens: Add photos or videos (camera app or gallery)** directly.

## Features (in-app camera)

- 📷 **Photo** — full-resolution stills via the camera's photo mode when the device supports it, otherwise a frame from the live preview. Saved as JPEG with adjustable quality.
- 🎥 **Video** — saved as MP4 when your Android System WebView can record it, otherwise WebM. Shows a recording timer and can stop automatically after a maximum length.
- 🔍 **Zoom** — pinch on the preview or use the slider. Uses the camera's own zoom when available; otherwise it crops the image digitally, and that zoom is also applied to recordings.
- 🔄 **Front/back camera switch**
- ⚡ **Flash / torch** — *Off → Flash* (photos only) *→ Torch* (always on).
- 🎯 **Tap to focus** — on devices that support it.
- 🎙️ **Sound toggle** for videos. The microphone is only used while recording.
- **Burst mode** — each capture is embedded right away. A counter and thumbnail show what you've added.
- Controls the device doesn't support are hidden automatically.

## Where files go

By default, captures go into a folder named after the note, next to the note:

```
Journal/
  Trip to Lisbon.md
  Trip to Lisbon.assets/
    IMG_20261010_143012.jpg
    VID_20261010_143120.mp4
```

You can change this in **Settings → Lens → Capture folder**:

| Pattern | Result for `Journal/Trip.md` |
|---|---|
| `{{noteName}}.assets` *(default)* | `Journal/Trip.assets/` |
| `media/{{noteName}}` | `Journal/media/Trip/` |
| `/Attachments/{{noteName}}` | `Attachments/Trip/` (from the vault root) |

Embeds follow your **Files & links** settings, so you get either `![[…]]` wikilinks or `![](…)` Markdown links.
If the note isn't open in editing mode, the embed is added to the end of the note.

## Usage

1. Open a note.
2. Tap the **camera** ribbon icon, or run **Lens: Open camera**.
   - Tip: add *Lens: Open camera* to the editor toolbar under **Settings → Mobile → Manage toolbar options** for one-tap access.
3. **Camera app mode:** tap **Take photo** or **Record video**, capture in your camera app and confirm (✓). The capture is
   embedded, and you can take more. Tap **Choose from gallery** to select several photos and videos at once (long-press to
   multi-select in the picker). Tap **Done** when finished.
4. **In-app camera mode:** choose **Photo** or **Video**, then press the shutter. Close the camera with ✕ or the Android back button.

If the note is open in editing mode, the embed goes at the cursor; otherwise it's added to the end of the note.

### Troubleshooting

Run **Lens: Show camera diagnostics**. It briefly opens each camera and shows what your device supports
(zoom, torch, focus, photo capture, video formats). Tap **Copy** to include the output in a bug report.

- *Taking a photo is slow or fails:* turn off **Full-resolution photos**.
- *"Android didn't let Obsidian read N files" when importing from the gallery:* Android's photo picker sometimes doesn't let
  Obsidian read some of the selected items (the plugin already re-reads them right away and retries). Add those items with
  **Browse files**, which uses Android's file browser and handles file access differently, or pick them one at a time.
- *Video files are large:* lower **Resolution** to 720p or set a **Maximum video length**.
- *"Camera not available":* update **Obsidian** and **Android System WebView** from the Play Store.

## Settings

| Setting | Default |
|---|---|
| Camera | Automatic |
| Capture folder | `{{noteName}}.assets` |
| JPEG quality | 0.9 |
| Full-resolution photos | On |
| Video resolution | 1080p |
| Record sound by default | On |
| Maximum video length | 0 (no limit) |
| Default camera | Back |

## Installing

### With BRAT (recommended while in beta)
1. Install **Obsidian42 - BRAT** from Community plugins.
2. In BRAT, choose *Add beta plugin* and enter `https://github.com/oguzhane/obsidian-lens-plugin`.
   - If the repository is private, first create a GitHub personal access token with read access to it
     (fine-grained: *Contents: Read-only*) and paste it into **BRAT settings → Personal GitHub access token**.
3. Enable **Lens** in Community plugins. BRAT can also check for updates when you publish new releases.

### Manually
Copy `main.js`, `manifest.json` and `styles.css` from a release into
`<your vault>/.obsidian/plugins/lens-camera/` on your phone (with a file manager, USB or your sync tool),
then enable **Lens** in Community plugins.

## Development

```bash
npm install
npm run dev        # rebuild main.js on change
npm run build      # typecheck + production bundle
npm test           # unit tests (Vitest)
```

To test on your phone, copy the built `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/lens-camera/`, then reload Obsidian. If WebView debugging is available on your
device, you can inspect the plugin from a desktop Chrome at `chrome://inspect` over USB.

### Project layout

```
src/
  main.ts                    plugin entry: ribbon icon, commands, settings
  settings.ts                settings model + validation
  errors.ts                  getUserMedia errors → user guidance
  camera/CameraController.ts stream lifecycle, zoom/torch/focus, photo capture, digital-zoom recording pipeline
  camera/recorder.ts         MediaRecorder wrapper, MP4/WebM selection
  camera/zoom.ts             zoom / pinch / crop / tap-mapping math
  camera/mediaTypes.ts       typings for Image Capture extensions
  storage/MediaStore.ts      folder creation, unique names, save + embed
  storage/NoteTarget.ts      inserts at the cursor or appends to the note
  storage/naming.ts          path and name helpers
  ui/CameraModal.ts          full-screen in-app camera UI
  ui/SystemCaptureModal.ts   capture through the phone's camera app (file input + capture)
  ui/DiagnosticsModal.ts     device capability report
  ui/SettingTab.ts           settings tab
tests/                       Vitest unit tests (Obsidian API mocked)
```

### Releasing
1. `npm version patch|minor|major`. This bumps `manifest.json` and `versions.json`.
2. `git push --follow-tags`. The GitHub Action runs the tests, builds the plugin and publishes a release with `main.js`, `manifest.json` and `styles.css`.

## License

MIT
