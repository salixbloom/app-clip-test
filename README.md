# Guided ARKit capture test

Experimental two-person capture: stationary subject, moving rear camera.

Open `native/GuidedCaptureDevice.xcodeproj` in Xcode, or use the GitHub Actions compile workflow. The initial build is unsigned and cannot be installed on an iPhone.

See [native setup](native/GuidedCapture/README.md) and [GitHub builds](native/GITHUB-BUILD.md). Automatic capture remains disabled in the device UI until image-quality checks are validated. A diagnostic frame save checks image/pose pairing without counting as an approved capture.

## Portable planner checks

Use Node 22 in a container, run `npm ci`, then `npm run check`. `npm run build` regenerates the bundled planner used by JavaScriptCore. No private scans, MetaHuman assets, Apple credentials, or upload endpoint are included.

This is source prepared for compilation, not validated medical or surgical software. See LICENSE.
