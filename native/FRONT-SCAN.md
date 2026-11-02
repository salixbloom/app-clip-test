# Front 180° capture workflow

The current app uses [continuous sweep selection](CONTINUOUS-SCAN.md), targeting
30 fps without per-photo dwell. The stop-at-marker behavior below describes the
earlier acquisition mode and its retained portable planner, not the current UI.

## Capture

One person sits still with a neutral expression; the operator moves the rear
camera. Start directly in front of the subject, in even light, with the whole
head visible. Tap the middle of the head, set approximate camera-to-head distance
(0.5–1.5 m), inspect the marker and confirm. The tap supplies a ray, not measured
depth. Incorrect distance or a sliding marker requires setting the centre again.
The confirmed camera bearing defines the front direction; it is not inferred
from the phone's compass or the subject's face.

Choose 24, 48, 64, 72, 96 or 128 photos before confirming. The default is 72:
24 positions per height band, -15°, 0°, +15°, each spanning -90° through +90°
including both profiles. Counts not divisible by three distribute the remainder
over the first bands. Three bands provide vertical parallax; image count alone
does not establish sufficient overlap or reconstruction quality.

Press **Calibrate & start automatic** while stationary in good light with a
visibly sharp subject. Twelve acceptable image comparisons establish a relative
sharpness reference (about 1.3 seconds minimum). Calibration cannot turn a poor
reference into good data. If it stalls, check lighting, focus, centre and framing.
Pause/restart recalibrates without deleting saved coverage. Manual **Take photo**
is always available with a confirmed centre and normal tracking; these diagnostic
images never complete automatic markers.

Follow the yellow marker and cover all three rows. Automatic photos require
normal ARKit tracking, radius within 12 cm, aim within 8°, elevation within 5°,
azimuth within 45% of local spacing, and experimental head-region checks. The
front scan handheld dwell is >=0.6 s, speed <=80 mm/s, angular speed <=6°/s, with
12 mm / 1.5° anchor bounds and continuous frames no more than 250 ms apart.
The legacy 360° planner retains its earlier stricter defaults.
Green means the exact frame's JPEG and metadata were saved; a flash/haptic gives
feedback. The next marker is nearest incomplete, not a mandatory sweep order.

## What image checks mean

The confirmed point and camera intrinsics project an approximate world-upright 26×36×26 cm head
box, projecting all eight corners so portrait buffer orientation is respected. It must fit inside the native image. This is geometric framing; it
does not detect hair edges, face identity, expressions or subject orientation.
Within that ROI, 32×32 luma samples provide Laplacian variance, clipped dark/bright
fractions, and mean-subtracted difference between adjacent stationary-camera
images. Reference calibration needs variance >=12, <40% dark, <25% bright and
mean absolute difference <14 intensity levels. Capture sharpness requires at
least 35% of the median reference variance and >=12. These are initial,
unvalidated thresholds; coarse sampling can miss fine blur or subtle movement.
Moving-camera samples and gaps yield unknown movement, never fabricated success.
Both a failed and an unavailable check block auto capture; manual remains separate.

Each metadata record includes the experimental method, reference score, scanId,
plan, exact native-buffer intrinsics/pose and `scaleValidated:false`. The minimum
100 MB free-space guard is a reserve, not a guarantee of enough space for a scan.

## Permanent storage and transfer

All originals remain in private local storage, including earlier sessions and
separate tracking origins. Export **all scans** creates a ZIP snapshot and opens
the system share sheet. Save it to Files or transfer it to the PC; keep the ZIP
permanently. No upload server is configured. App removal may erase private data.
The app cannot certify that a share destination completed a durable backup.
Interruption/restart/recentring requires new confirmation and a new coverage plan;
old photos remain exportable. Do not combine different origins without alignment.

After extracting the ZIP to a permanent private directory, use the existing
`ffs-metahuman-reconstruct` Python container with the source mounted read-only:

```
python tools/metahuman/import_arkit_scan.py /capture /app/artifacts/metahuman/phone-scan-new --scan-id SCAN_ID
```

The importer lists available IDs if there is more than one scan. It checks JPEG
hashes, decoded dimensions, proper poses, intrinsics and consistent plans before
preparing one origin/scan's COLMAP text model and untouched JPEG copies. It uses
per-frame calibration. Diagnostic images need explicit `--include-diagnostic` and
never increase guided coverage. Output must be new; originals are not overwritten.
Masks, overlap/seed tracks and image/pose validation remain necessary before dense
reconstruction. The existing Unreal-specific dense preparation is not reused for
phone metadata, and no reconstruction job starts automatically.

## Unobserved rear head

Plans declare `rearGeometry: unobserved-template-completion-only`. Captures cover
facial geometry and profiles, not the back of the skull. A later editor may fit a
smooth generic head template behind the observed region, with the join outside
the measured face. That completion must remain separately labelled and excluded
from photo-derived accuracy/measurement claims. This revision records the policy;
it does not generate a fictitious rear reconstruction. Frontal photos also cannot
establish hidden bone shape or replace anatomical imaging.

Apple API reference: [Foundation ZIP snapshots](https://developer.apple.com/documentation/foundation/nsfilecoordinator/readingoptions/foruploading).
