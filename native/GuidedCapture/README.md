# Native front-half capture

Current UI: [Continuous 30 fps stream selection](../CONTINUOUS-SCAN.md), three
height passes, missing-view retakes and explicit PC head-crop normalization.
This replaces the earlier stop-at-each-marker UI described by older device notes.

The installed standalone capture app uses the rear camera and ARKit world tracking.
This is an experimental acquisition tool for one stationary subject and a second
person operating the phone. See [FRONT-SCAN.md](../FRONT-SCAN.md) for the complete
capture/export/import workflow and limitations. It does not predict surgical outcomes.

The previous manual-only build ran on the user's iPhone. This revision adds a
front 180-degree guided scan; hardware quality and usability need testing again.
GitHub macOS compiles simulator, unsigned iPhone host/Clip, and standalone targets.
A successful compile does not validate captured geometry or camera scale.

## Source and data

- `ARKitCaptureController.swift`: rear-camera tracking, highest supported <=30fps
  format, autofocus, same-frame native JPEG/K/pose, head-region sampling, serial
  storage, free-space check, all-session ZIP export.
- `CaptureScreen.swift`: front-direction/approximate-distance confirmation,
  24/48/64/72/96/128 targets, three-row inset, manual capture, calibrated automatic
  mode, saved count, haptic/flash feedback, local sharing, retained archive count.
- `Resources/GuidedNative.js`: generated from `src/capture/guided-native.ts` and
  the shared planner. No remote JavaScript, website dependency or network upload.

Every committed frame is `<session>/<origin>/<frame>/image.jpg` + `metadata.json`.
Photos retain native pixel orientation, dimensions, intrinsics, SHA256 and
right-handed Y-up metre camera-to-world pose from the exact ARFrame callback.
A hidden staging directory is renamed only after both files are synchronized.
Failed saves never complete a marker. Manual frames remain `diagnostic` and do
not fill guided coverage. Recentring creates a unique scanId and resets markers;
tracking interruptions create a new origin. Earlier photos are never discarded.

The archive remains in private Application Support storage across launches.
Uninstalling the app can delete it: export a separate ZIP before removal.
The new app counts committed archived pairs on launch but never resumes old AR
coordinates. Export includes all retained sessions and their original scan plans.
There is no automatic cloud backup or configured backend endpoint.

## Build and verification

Use the existing `ffs-planner-check` container mounted at `/app`, with its own
`/app/node_modules` volume:

```
node_modules/.bin/esbuild src/capture/guided-native.ts --bundle --format=iife --global-name=GuidedNative --platform=neutral --target=es2020 --outfile=native/GuidedCapture/Resources/GuidedNative.js
node tools/test-native-bundle.mjs
npm run check
```

`tools/metahuman/generate_native_project.py` generates the host, embedded Clip and
standalone personal-signing test target. Do not regenerate over real signing
settings without reviewing the result. Windows has no local iOS SDK; see
[GITHUB-BUILD.md](../GITHUB-BUILD.md) and [DEVICE-TEST.md](../DEVICE-TEST.md).

Physical-device checks remain required for actual image/pose alignment, head ROI
alignment, realistic handheld dwell, lighting changes, expressions, profiles,
storage errors and exported files. Image stability is a photometric heuristic,
not a face/identity tracker. No anatomical or clinical accuracy is established.
