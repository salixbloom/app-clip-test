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
    evaluateFrame: () => evaluateFrame,
    initialise: () => initialise,
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
  function orbitSlots(total = 72) {
    if (!Number.isInteger(total) || total < 24 || total > 128) throw new Error("Choose 24\u2013128 capture positions");
    const slots = [];
    for (let band = 0; band < 3; band++) {
      const count = Math.floor(total / 3) + (band < total % 3 ? 1 : 0);
      for (let j = 0; j < count; j++) slots.push({ id: slots.length, azimuth: 2 * Math.PI * j / count, elevation: radians([-15, 0, 15][band]) });
    }
    return slots;
  }
  var GuidedOrbit = class {
    constructor(total = 72) {
      __publicField(this, "slots");
      __publicField(this, "centre", null);
      __publicField(this, "radius", 1);
      __publicField(this, "segment", "");
      __publicField(this, "generation", 0);
      __publicField(this, "sequence", 0);
      __publicField(this, "done", /* @__PURE__ */ new Set());
      __publicField(this, "pending", null);
      __publicField(this, "previous", null);
      __publicField(this, "anchor", null);
      __publicField(this, "activeSlot", -1);
      this.slots = orbitSlots(total);
    }
    /** Explicit confirmation required: a screen tap alone cannot determine depth. Resets coverage. */
    setCentre(centre, radiusMetres, segment) {
      if (!finite(centre) || !Number.isFinite(radiusMetres) || radiusMetres < 0.5 || radiusMetres > 1.5 || !segment) throw new Error("Invalid confirmed scan centre");
      this.centre = [...centre];
      this.radius = radiusMetres;
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
    update(frame) {
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
      const azimuth = Math.atan2(offset[0], offset[2]), elevation = Math.atan2(offset[1], Math.hypot(offset[0], offset[2]));
      const candidates = this.slots.filter((s) => !this.done.has(s.id));
      const score = (s) => wrap(azimuth - s.azimuth) ** 2 + (elevation - s.elevation) ** 2;
      const next = candidates.reduce((best, s) => score(s) < score(best) ? s : best, candidates[0]);
      if (Math.abs(distance - this.radius) > 0.12) return refuse(distance > this.radius ? "Move closer" : "Move farther away", next);
      if (angle(frame.forward, sub(this.centre, frame.position)) > radians(8)) return refuse("Aim at the centre of the head", next);
      if (frame.subjectStill !== true) return refuse("Ask the subject to hold still \u2014 verify alignment", next);
      if (frame.framed !== true) return refuse("Keep the entire head in frame", next);
      if (frame.exposed !== true) return refuse("Adjust lighting \u2014 avoid dark areas and glare", next);
      if (frame.sharp !== true) return refuse("Wait for a sharp image", next);
      const perBand = this.slots.filter((s) => s.elevation === next.elevation).length;
      if (Math.abs(wrap(azimuth - next.azimuth)) > 2 * Math.PI / perBand * 0.32) return refuse("Move around the subject toward the next marker", next);
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
      if (length(sub(frame.position, prev.position)) / dt > 0.025 || angle(frame.forward, prev.forward) / dt > radians(2)) {
        this.anchor = this.previous;
        return result("Hold camera still", next);
      }
      const anchor = this.anchor;
      if (length(sub(frame.position, anchor.position)) > 6e-3 || angle(frame.forward, anchor.forward) > radians(0.8)) {
        this.anchor = this.previous;
        return result("Hold camera still", next);
      }
      if (frame.timestamp - anchor.timestamp < 0.7) return result("Hold camera still", next);
      const ticket = { token: ++this.sequence, generation: this.generation, slot: next.id, frame: this.previous };
      this.pending = { ...ticket, frame: { ...ticket.frame, position: [...ticket.frame.position], forward: [...ticket.frame.forward] } };
      return result("Capture now", next, ticket);
    }
  };

  // src/capture/guided-native.ts
  var planner = new GuidedOrbit();
  function initialise(count) {
    planner = new GuidedOrbit(count);
  }
  function setCentre(json) {
    const v = JSON.parse(json);
    planner.setCentre(v.centre, v.radius, v.segment);
  }
  function evaluateFrame(json) {
    return JSON.stringify(planner.update(JSON.parse(json)));
  }
  function acknowledge(token, generation, saved) {
    return planner.acknowledge(token, generation, saved);
  }
  function coverage() {
    return JSON.stringify(planner.coverage());
  }
  return __toCommonJS(guided_native_exports);
})();
