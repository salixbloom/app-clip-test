# Free-account device test route

2026-11-01: user has a free Apple Account, Windows, and GitHub macOS compilation.
`CaptureDeviceTest` is a standard development app containing the same camera,
planner and diagnostic screen. It has no embedded App Clip, target dependency,
associated-App-Clip entitlement or parent-App-Clip entitlement. This is a
temporary hardware-test route; it does not establish App Clip distribution.

The workflow compiles this target unsigned and packages it as
`CaptureDeviceTest-unsigned.ipa`, with SHA256SUMS.txt in artifact
`unsigned-capture-device-test`. The IPA is NOT directly installable: it must be
signed/provisioned for the device before iOS will run it. Packaging checks that
no AppClips folder is embedded. Existing host+Clip compilation checks remain.

## Windows personal sideloading

AltStore Classic documents using AltServer on Windows and a regular Apple
Account to sign/install apps. It requires additional Windows software and an
iPhone connection. Follow its current official setup instructions:

- https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows
- https://faq.altstore.io/altstore-classic/your-altstore

Use Classic, not the separate PAL marketplace product. Free-account provisioning
has expiry/refresh and active-app limitations; inspect the current official
instructions. Compatibility of this particular app and personal signing is not
yet device-tested. Do not treat an unsigned successful build as proof it installs.

AltServer and required Apple Windows components were installed with the user's
authorization; the user has confirmed running the installed iPhone app. Apple
credentials must be entered only in the selected local signing software, never
in this chat, repository, workflow logs or public CI secrets. No paid account,
purchase, device registration or certificate operation has been performed.

After successful personal signing/installation, enable Developer Mode if iOS
requests it, grant camera permission, verify normal tracking, confirm the scan
centre, and save/share one diagnostic JPEG/JSON pair. Automatic guided capture
remains disabled pending quality detectors and threshold validation. Diagnostic
images never count as approved coverage.

The test screen exposes a **Take photo** button and a saved-photo count. Confirm
the centre and wait for normal tracking before using it. Manual preview does not
require automatic quality-detector results: those detectors are not connected
yet. A missing subject-motion result must never be reported as detected motion.
Automatic mode continues to refuse unknown checks and never counts manual photos
as guided coverage.

The device test is incomplete until decoded image dimensions, SHA256 and visible
target projection agree with the saved K/pose/orientation. Subject and marker
stability must also be judged on hardware. This is not an anatomical or clinical
measurement validation.
