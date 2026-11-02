# Continuous front-arc scanning

This revision selects still images directly from the live ARKit camera stream,
targeting 30 fps. It does not save a MOV or a full video archive. Only selected
original JPEGs and their exact-frame metadata are retained permanently in the
existing local archive; export a ZIP for a separate backup. This avoids storing
thousands of redundant frames while preserving the reconstruction inputs.

## Phone flow

1. Choose 24–128 views (default 128), begin directly in front and confirm the head
   centre/distance as before. Closer head framing captures more facial pixels.
2. Choose Low, Level or High. Start the pass while holding still briefly for
   relative sharpness calibration, with the subject visibly sharp in good light.
3. Sweep slowly from one profile to the other. Do not stop at every marker.
   The subject keeps the same neutral expression throughout and between passes.
4. Finish the pass to flush its final selected frame. Green is durably saved;
   orange marks missing views in the selected row; yellow is the current candidate.
5. Revisit only missing markers, start that same pass, take the missing angle,
   then finish. Existing saved views are skipped. Repeat for the other heights.
6. Export all scans. Original photos, previous sessions and old test captures
   are retained; the existing importer still isolates one tracking origin/scan.

## Selection and quality

`guided-sweep.ts` keeps one best candidate in the current angular sector. It
ranks angular closeness to the target with a smaller relative sharpness bonus.
Leaving the sector commits the best earlier exact frame; it does not save the
new callback frame under the old frame's pose. The host retains just that one
candidate ARFrame, then encodes it before replacing the buffer. A save failure
leaves the marker missing and pauses capture. End-of-pass, pause and export flush
the last candidate. Recentring/origin changes invalidate unsaved candidates.

Candidates require normal tracking, near the selected height/radius, an aim at
the head, acceptable exposure/sharpness, and a single face detected in THAT
frame by Apple Vision. The expanded face rectangle estimates head framing; it
is not a hair/ear segmentation model. Multiple faces, absent/uncertain detections
and clipped estimates are rejected. Profiles can be harder to detect and may
need retakes. Native-buffer coordinates are derived from upright portrait Vision
coordinates; raw pixels and camera intrinsics are not rotated or cropped.

Translation above .25 m/s prompts slower motion. There is no per-marker dwell.
The selector uses the same three -15/0/+15-degree front-180 rows as before.
These remain experimental thresholds, not an overlap or facial-accuracy guarantee.
Blur is scored with a two-pixel Laplacian sampled on a 64×64 grid in original
head-region pixels, with a relative calibrated threshold. The separate 32×32
grid supplies exposure/temporal checks. Relative sharpness is still a heuristic
and cannot certify every detail or detect every motion-blurred image.

Subject movement cannot be inferred from raw image differences while the phone
is moving. Sweep records explicitly store `subjectStill:null` and
`subjectMotionMethod:not-measured-during-camera-motion`; no passing stillness
result is invented. Same-expression/subject-still instructions remain essential.

`capturePurpose:sweep` separates this acquisition method from the earlier dwell
mode. The strict guided-only reader refuses sweep records; the explicit phone
importer accepts them and reports their provenance. Each selected record includes
same-frame expanded `headBoundsNative:[x,y,width,height]` in original pixel axes,
the quality reference, and nominal camera stream FPS. Actual analysis/selection
rate can be lower due to device load, Vision and JPEG storage. The app does not
promise that every camera frame is analysed or that 128 acceptable views exist.

## Head normalization on the PC

After importing the exported archive using `import_arkit_scan.py`, run in the
existing `ffs-metahuman-reconstruct` container:

```
python tools/metahuman/normalize_phone_frames.py /verified-scan /new-normalized-output --size 1536
```

Every selected frame must have its same-frame head bounds. Earlier captures
without bounds are refused instead of receiving guessed crops. The program
uniformly scales and pads the crop into a square canvas: it does not stretch,
warp, frontalize, align eyes, or change head shape to match another view.
The exact image affine transform updates K (`K_new = A K_original`); original
camera-to-world pose stays unchanged. Original images are not overwritten.
Upsampling adds no captured detail. Face detection can still misestimate the
head extent; retain originals for crop review and reconstruction alternatives.

Normalized records use `arkit-normalized-image-record-v1`, retain source-image
hash/intrinsics/crop provenance, and can be imported explicitly by the Python
archive importer. A valid crop can move the principal point outside its canvas;
the importer checks the affine calibration rather than pretending it is centred.
The original native-record TypeScript parser is not a normalized-record reader.

## Verification and remaining device test

Tests cover continuous selection without dwell, angular choice, sharpness/face/
exposure refusal, missing-only retakes, exact-frame tickets, durable-save failure,
origin changes and all 128 targets. Python tests verify affine projection across
crop/padding and refusal of clipped boxes. Native compilation is checked through
the existing GitHub workflow. Real 30 fps performance, face detection at profiles,
motion blur and pass duration must still be exercised on the phone.

Apple reference: [Vision image request handler](https://developer.apple.com/documentation/vision/vnimagerequesthandler).
