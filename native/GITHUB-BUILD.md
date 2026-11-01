# GitHub compilation handoff

Prepared 2026-11-01. Target repository: `salixbloom/app-clip-test`.
The dedicated `codex/native-capture` branch triggers compilation over SSH pushes;
manual workflow dispatch is also available to an authenticated GitHub session.

## Repository contents

The target repository can be native-only. Include:

- `.github/workflows/native-capture.yml`
- `native/GuidedCaptureDevice.xcodeproj/`, including its shared schemes
- `native/GuidedCapture/`, including `Resources/GuidedNative.js`
- `src/capture/guided-orbit.ts` and `src/capture/guided-native.ts`, the preferred
  source for the bundled planner
- `package.json` and `package-lock.json` for the documented planner build tooling
- `LICENSE` and applicable copyright notices

The generated JavaScript bundle is self-contained; CI does not install Node,
download project dependencies, regenerate the Xcode project, or need MetaHuman
assets, scans, reconstruction outputs or any `artifacts/` directory.
For continued planner development, keep the TypeScript source and build helpers
available in the source distribution and regenerate the bundle before copying.
Do not publish private Epic assets or face data with the native sources.
The workflow and shell syntax can be checked locally in `ffs-planner-check`
using `node tools/check-native-workflow.mjs`; this never launches a remote run.

## Workflow behavior

After the workflow is on the default branch, manual runs use Actions → Native
capture compile check → Run workflow. Push runs are restricted to native/project
changes on `codex/native-capture`; there is no pull-request trigger.
It uses a standard `macos-15` runner, read-only checkout
permissions, no persisted Git credentials, a 20-minute timeout and cancellation
of an earlier run on the same branch.

It builds the CaptureHost scheme, which depends on and embeds CaptureClip,
against the simulator SDK and then the iPhone SDK. Both builds disable signing.
Logs record the selected Apple toolchain and are retained for three days.
It does not access Apple credentials, upload an app, publish a release, or process
photos. Successful compilation does NOT produce an installable signed iPhone
build, validate ARKit tracking, or establish that App Clip invocation works.

If simulator compilation fails, the device build does not run; inspect the
first failing error in `simulator.txt`. Otherwise inspect `device.txt` as well.
Return logs for fixes before provisioning/signing work.

## Cost boundary

GitHub documents standard hosted runners as free for public repositories;
private repositories draw on account/plan allowances and may incur usage charges.
Check the target account's Actions budget before launching. This workflow does
not enforce account billing settings or promise free signing/distribution.

## Remaining device/distribution work

Select actual bundle identifiers and an Apple team; configure matching Clip and
parent entitlements, provisioning, and the intended testing/distribution route.
No certificates or secrets belong in git. Simulator runtime cannot validate the
ARKit capture. Device testing follows a successful signed build, using the
diagnostic sequence in `GuidedCapture/README.md`.

Sources checked 2026-11-01:

- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://github.com/actions/checkout
- https://github.com/actions/upload-artifact
