# Native guided capture scaffold

Status (2026-11-01): native screen/controller, generated host+App Clip Xcode
project, and tested portable bridge. **Neither iOS target has been compiled,
signed or run.** This Windows workspace has no macOS/iOS SDK. Source/project
structure checks are not substitutes for Xcode compilation or a device test.

`ARKitCaptureController.swift` connects rear-camera world tracking to the exact
planner used by the desktop simulator through bundled JavaScriptCore. There is
no remote JavaScript, WebView, network call or duplicated Swift planner.

Implemented source paths:

- Per-frame ARKit position/negative-Z forward vector, timestamp, tracking state.
- New origin segment on start/interruption/failure; explicit centre confirmation.
- Initial luma-plane Laplacian variance and clipped-dark/bright fractions, with
  video-range conversion. These are whole-image scores: background texture or
  noise can fool sharpness; they are not a validated head-focused quality test.
- Quality policy and head-framing/subject-still provider default to unknown;
  capture stays blocked. There are no fabricated passing detector outputs.
- Same-callback ARFrame JPEG, native pixel dimensions, column-major camera-to-world
  transform in metres and pinhole intrinsics. No image resize, crop or rotation.
- SHA256 image hash and `arkit-image-record-v1` JSON; pair staged in `.pending-*`,
  each file synchronized, then directory renamed. Failed writes never complete
  an orbit marker. Importers must ignore incomplete staging directories.
- Live portrait camera screen, runtime camera permission, tracking status,
  projected 3D orbit inset, and centre candidate marker. Tap direction uses the
  viewport camera projection, with a user-specified approximate distance.
  Centre confirmation does not claim measured depth or camera calibration.
- Explicit manual diagnostic-frame save and system share sheet for the local
  JPEG/JSON pair. Diagnostics carry `capturePurpose: diagnostic`; they never
  acknowledge a guided ticket or complete an orbit slot. The guided-only reader
  refuses diagnostic records. Automatic capture stays disabled in this UI.

Archive layout beneath the host-supplied private local root:

    <session UUID>/<origin segment UUID>/<frame UUID>/image.jpg
    <session UUID>/<origin segment UUID>/<frame UUID>/metadata.json

The folder rename is the application commit boundary. Power-loss/filesystem
durability and iOS data protection require device testing; do not promise this
as a permanent archive. Original images stay paired with original K/pose.
Slot, generation, origin segment and timestamp are separate identifiers. Raw
captures from separate origin segments must not be merged without alignment.

## Build the planner resource

Run inside existing `ffs-planner-check` container with repo `/app`, working dir
`/app`, and container-owned `/app/node_modules`:

    node_modules/.bin/esbuild src/capture/guided-native.ts --bundle --format=iife --global-name=GuidedNative --platform=neutral --target=es2020 --outfile=native/GuidedCapture/Resources/GuidedNative.js
    node tools/test-native-bundle.mjs
    npm run check

The 8.5KB resource is generated from project source. The clean-context test runs
the exact IIFE without DOM, fetch or Node globals. It is not JavaScriptCore or
hardware validation. Native record parsing/projection tests live under
`src/capture/guided-native.test.ts`.

## Generated device project

Open `native/GuidedCaptureDevice.xcodeproj` on a Mac. It contains shared
`CaptureHost` and `CaptureClip` schemes, both iOS16+/portrait/Swift5. Start with
CaptureHost on an attached iPhone to validate the camera/storage path before
debugging App Clip invocation. Host installation is a development step; the
intended end-user flow remains App Clip invocation without installing the host.

The project uses placeholder identifiers `com.example.FFSCapture` and `.Clip`.
Select the Apple development team, replace both bundle identifiers AND matching
parent/Clip entitlement values, and configure actual invocation/associated
domains before App Clip distribution. The Clip scheme's `_XCAppClipURL` uses
`https://example.invalid/capture` deliberately; it is not a deployed invocation.
The host embeds and depends on the Clip. No account, provisioning profile,
external domain, credential or upload destination is included.
For the prepared manual GitHub compilation workflow and native-only repository
contents, see `native/GITHUB-BUILD.md`. No remote run has occurred.

Regenerate the deterministic Xcode project/Info/entitlements/schemes in the
reconstruction container using:

    python tools/metahuman/generate_native_project.py

Regeneration overwrites project signing/bundle configuration placeholders;
preserve any local signing changes before regenerating. The generator validates
object references, source/resource paths and plist structure, not Xcode semantics.

On macOS, an unsigned simulator SDK build can first check compilation:

    xcodebuild -project native/GuidedCaptureDevice.xcodeproj -scheme CaptureHost -destination 'generic/platform=iOS Simulator' -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build

This command has NOT run here. ARKit tracking itself still requires an iPhone.
The native Swift callback actor isolation and generated project must be checked
against the actual selected Xcode SDK before describing the build as working.

## Device milestone and remaining integration

Load the bundled resource as a String, construct the controller with a private
Application Support capture directory, and wire `onGuidance` to the overlay.
All planner calls and file writes run on a serial delegate queue; UI callbacks
arrive on main. Do not read `session.currentFrame` when a ticket fires.

First device sequence: allow camera, wait for normal tracking, tap the stationary
subject's head, adjust approximate distance, verify the marker stays at the head
while moving slightly, confirm centre, save one diagnostic frame, and share the
saved pair for independent hash/dimension/projection checks. Movement that makes
the point slide relative to the head indicates wrong centre/depth or tracking.
Diagnostic saves deliberately allow unknown quality scores and do not establish
facial accuracy or suitable reconstruction coverage.

Still implement head-aware framing/movement checks across profiles/back views,
validated quality thresholds, depth-assisted centre verification, disk-space/error
recovery, local archive restoration and foreground upload. Lifecycle background
pauses stop the camera and require a new centre after restart.
The archive is local only; no endpoint/credentials or real-face transfer exists.
The `src/capture/arkit-record.ts` parser enforces metadata geometry/provenance,
but archive image hash and decoded JPEG dimensions must also be checked on import.

Before any real reconstruction: compile in Xcode; exercise permissions, camera
buffer orientation, projection against visible targets, normal/limited tracking,
interruption/reset/recentre, storage failure, exact-frame pairing, and transfer
retry behavior on a physical iPhone. ARKit metre poses are unvalidated scale,
not reference-object evidence or facial/surgical accuracy clearance.

Apple references checked 2026-11-01:

- https://developer.apple.com/documentation/arkit/arframe
- https://developer.apple.com/documentation/arkit/arcamera
- https://developer.apple.com/documentation/javascriptcore/jscontext
