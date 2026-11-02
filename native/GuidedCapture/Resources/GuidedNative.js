"use strict";
var GuidedNative = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/capture/guided-native.ts
  var guided_native_exports = {};
  __export(guided_native_exports, {
    acknowledge: () => acknowledge,
    coverage: () => coverage,
    evaluateDiagnosticFrame: () => evaluateDiagnosticFrame,
    evaluateFrame: () => evaluateFrame,
    evaluateQuality: () => evaluateQuality,
    initialise: () => initialise,
    resetQuality: () => resetQuality,
    setCentre: () => setCentre
  });

  // src/capture/guided-orbit.ts
  var sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  var length = (v) => Math.hypot(...v);
  var dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  var unit = (v) => {
    const n = length(v);
    return [v[0] / n, v[1] / n, v[2] / n];
  };
  var angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b)))));
  var wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  var radians = (degrees) => degrees * Math.PI / 180;
  var finite = (v) => v.length === 3 && v.every(Number.isFinite);
  function orbitSlots(total = 72, arcDegrees = 360) {
    if (!Number.isInteger(total) || total < 24 || total > 128) throw new Error("Choose 24\u2013128 capture positions");
    const slots = [];
    for (let band = 0; band < 3; band++) {
      const count = Math.floor(total / 3) + (band < total % 3 ? 1 : 0);
      for (let j = 0; j < count; j++) slots.push({ id: slots.length, azimuth: arcDegrees === 180 ? -Math.PI / 2 + Math.PI * j / (count - 1) : 2 * Math.PI * j / count, elevation: radians([-15, 0, 15][band]) });
    }
    return slots;
  }
  var GuidedOrbit = class {
    constructor(total = 72, arcDegrees = 360, handheld = false) {
      this.arcDegrees = arcDegrees;
      this.handheld = handheld;
      __publicField(this, "slots");
      __publicField(this, "centre", null);
      __publicField(this, "radius", 1);
      __publicField(this, "frontAzimuth", 0);
      __publicField(this, "segment", "");
      __publicField(this, "generation", 0);
      __publicField(this, "sequence", 0);
      __publicField(this, "done", /* @__PURE__ */ new Set());
      __publicField(this, "pending", null);
      __publicField(this, "previous", null);
      __publicField(this, "anchor", null);
      __publicField(this, "activeSlot", -1);
      this.slots = orbitSlots(total, arcDegrees);
    }
    /** Explicit confirmation required: a screen tap alone cannot determine depth. Resets coverage. */
    setCentre(centre, radiusMetres, segment, frontAzimuth = 0) {
      if (!finite(centre) || !Number.isFinite(radiusMetres) || radiusMetres < 0.5 || radiusMetres > 1.5 || !segment) throw new Error("Invalid confirmed scan centre");
      if (!Number.isFinite(frontAzimuth)) throw new Error("Invalid front direction");
      this.centre = [...centre];
      this.radius = radiusMetres;
      this.frontAzimuth = frontAzimuth;
      this.segment = segment;
      this.generation++;
      this.done.clear();
      this.pending = null;
      this.pause();
    }
    pause() {
      this.previous = null;
      this.anchor = null;
      this.activeSlot = -1;
    }
    /** Mark complete only after the exact ticket image and metadata are durably saved. */
    acknowledge(token, generation, saved) {
      if (!this.pending || this.pending.token !== token || this.pending.generation !== generation) return false;
      if (saved) this.done.add(this.pending.slot);
      this.pending = null;
      this.pause();
      return true;
    }
    coverage() {
      return this.slots.map((s) => this.done.has(s.id));
    }
    update(frame, captureEnabled = true) {
      const result = (message, next2 = null, ticket2 = null) => ({ message, completed: this.done.size, total: this.slots.length, next: next2, ticket: ticket2 });
      const refuse = (message, next2 = null) => {
        this.pause();
        return result(message, next2);
      };
      if (!this.centre) return refuse("Set and confirm the scan centre");
      if (frame.segment !== this.segment) {
        this.centre = null;
        this.generation++;
        this.pending = null;
        return refuse("Tracking origin changed \u2014 set scan centre again");
      }
      if (this.pending) return result("Saving photo \u2014 hold still");
      if (this.done.size === this.slots.length) return result("Capture complete");
      if (!Number.isFinite(frame.timestamp) || !frame.id || !finite(frame.position) || !finite(frame.forward) || length(frame.forward) < 0.9) return refuse("Waiting for valid camera data");
      if (frame.tracking !== "normal") return refuse("Pause \u2014 camera tracking needs to recover");
      const offset = sub(frame.position, this.centre), distance = length(offset);
      if (distance < 1e-6) return refuse("Move away from the scan centre");
      const azimuth = wrap(Math.atan2(offset[0], offset[2]) - this.frontAzimuth), elevation = Math.atan2(offset[1], Math.hypot(offset[0], offset[2]));
      const candidates = this.slots.filter((s) => !this.done.has(s.id));
      const score = (s) => wrap(azimuth - s.azimuth) ** 2 + (elevation - s.elevation) ** 2;
      const next = candidates.reduce((best, s) => score(s) < score(best) ? s : best, candidates[0]);
      if (Math.abs(distance - this.radius) > 0.12) return refuse(distance > this.radius ? "Move closer" : "Move farther away", next);
      if (angle(frame.forward, sub(this.centre, frame.position)) > radians(8)) return refuse("Aim at the centre of the head", next);
      if (!captureEnabled) {
        this.pause();
        return result("Ready for a manual photo", next);
      }
      if (frame.subjectStill === null) return refuse("Subject motion check unavailable \u2014 use manual capture", next);
      if (frame.subjectStill !== true) return refuse("Subject moved or image changed \u2014 pause briefly", next);
      if (frame.framed === null) return refuse("Head framing check unavailable \u2014 use manual capture", next);
      if (frame.framed !== true) return refuse("Keep the entire head in frame", next);
      if (frame.exposed === null) return refuse("Exposure check unavailable \u2014 use manual capture", next);
      if (frame.exposed !== true) return refuse("Adjust lighting \u2014 avoid dark areas and glare", next);
      if (frame.sharp === null) return refuse("Sharpness check unavailable \u2014 use manual capture", next);
      if (frame.sharp !== true) return refuse("Wait for a sharp image", next);
      const perBand = this.slots.filter((s) => s.elevation === next.elevation).length;
      const spacing = this.arcDegrees === 180 ? Math.PI / (perBand - 1) : 2 * Math.PI / perBand;
      if (Math.abs(wrap(azimuth - next.azimuth)) > spacing * (this.arcDegrees === 180 ? 0.45 : 0.32)) return refuse("Move around the subject toward the next marker", next);
      if (Math.abs(elevation - next.elevation) > radians(5)) return refuse(elevation < next.elevation ? "Raise the camera" : "Lower the camera", next);
      const prev = this.previous;
      this.previous = { ...frame, position: [...frame.position], forward: [...frame.forward] };
      if (!prev || this.activeSlot !== next.id) {
        this.activeSlot = next.id;
        this.anchor = this.previous;
        return result("Hold camera still", next);
      }
      const dt = frame.timestamp - prev.timestamp;
      if (dt <= 0 || dt > 0.25 || frame.id === prev.id) {
        this.pause();
        return result("Waiting for a continuous camera stream", next);
      }
      if (length(sub(frame.position, prev.position)) / dt > (this.handheld ? 0.08 : 0.025) || angle(frame.forward, prev.forward) / dt > radians(this.handheld ? 6 : 2)) {
        this.anchor = this.previous;
        return result("Hold camera still", next);
      }
      const anchor = this.anchor;
      if (length(sub(frame.position, anchor.position)) > (this.handheld ? 0.012 : 6e-3) || angle(frame.forward, anchor.forward) > radians(this.handheld ? 1.5 : 0.8)) {
        this.anchor = this.previous;
        return result("Hold camera still", next);
      }
      if (frame.timestamp - anchor.timestamp < (this.handheld ? 0.6 : 0.7)) return result("Hold camera still", next);
      const ticket = { token: ++this.sequence, generation: this.generation, slot: next.id, frame: this.previous };
      this.pending = { ...ticket, frame: { ...ticket.frame, position: [...ticket.frame.position], forward: [...ticket.frame.forward] } };
      return result("Capture now", next, ticket);
    }
  };

  // src/capture/guided-native.ts
  var planner = new GuidedOrbit();
  function initialise(count, arcDegrees = 360) {
    planner = new GuidedOrbit(count, arcDegrees, arcDegrees === 180);
  }
  function setCentre(json) {
    const v = JSON.parse(json);
    planner.setCentre(v.centre, v.radius, v.segment, v.frontAzimuth);
  }
  function evaluateFrame(json) {
    return JSON.stringify(planner.update(JSON.parse(json)));
  }
  function evaluateDiagnosticFrame(json) {
    return JSON.stringify(planner.update(JSON.parse(json), false));
  }
  function acknowledge(token, generation, saved) {
    return planner.acknowledge(token, generation, saved);
  }
  function coverage() {
    return JSON.stringify(planner.coverage());
  }
  var reference = null;
  var calibration = [];
  var previous = null;
  function resetQuality() {
    reference = null;
    calibration = [];
    previous = null;
  }
  function evaluateQuality(json) {
    const s = JSON.parse(json);
    const unknown = { sharp: null, exposed: null, framed: s.framed, subjectStill: null, reference, calibrating: reference === null };
    if (!s.framed || !Number.isFinite(s.timestamp) || s.pixels.length !== 1024 || s.pixels.some((v) => !Number.isFinite(v) || v < 0 || v > 255)) {
      previous = null;
      return JSON.stringify(unknown);
    }
    const mean = s.pixels.reduce((a, b) => a + b, 0) / 1024;
    const dark = s.pixels.filter((v) => v < 8).length / 1024, bright = s.pixels.filter((v) => v > 247).length / 1024;
    let sum = 0, squares = 0, n = 0;
    for (let y = 1; y < 31; y++) for (let x = 1; x < 31; x++) {
      const i = y * 32 + x, lap = s.pixels[i - 1] + s.pixels[i + 1] + s.pixels[i - 32] + s.pixels[i + 32] - 4 * s.pixels[i];
      sum += lap;
      squares += lap * lap;
      n++;
    }
    const sharpness = Math.max(0, squares / n - (sum / n) ** 2), exposed = dark < 0.4 && bright < 0.25;
    const prior = previous;
    previous = s;
    const continuous = prior !== null && s.timestamp > prior.timestamp && s.timestamp - prior.timestamp <= 0.25 && s.cameraStill && prior.cameraStill;
    const oldMean = prior ? prior.pixels.reduce((a, b) => a + b, 0) / 1024 : 0;
    const difference = continuous ? s.pixels.reduce((a, v, i) => a + Math.abs(v - mean - (prior.pixels[i] - oldMean)), 0) / 1024 : null;
    const still = difference === null ? null : difference < 14;
    if (reference === null && s.cameraStill && still === true && exposed && sharpness >= 12) {
      calibration.push(sharpness);
      if (calibration.length >= 12) reference = [...calibration].sort((a, b) => a - b)[Math.floor(calibration.length / 2)];
    }
    return JSON.stringify({
      sharp: reference === null ? null : sharpness >= Math.max(12, reference * 0.35),
      exposed,
      framed: true,
      subjectStill: still,
      reference,
      calibrating: reference === null,
      calibrationFrames: calibration.length,
      sharpnessScore: sharpness,
      darkFraction: dark,
      brightFraction: bright,
      difference
    });
  }
  return __toCommonJS(guided_native_exports);
})();
