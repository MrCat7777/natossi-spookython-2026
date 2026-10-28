import test from "node:test";
import assert from "node:assert/strict";
import { SimulationClock } from "../dist/playback.js";

function setup(options = {}) {
  const frames = [];
  let next = null;
  let complete = 0;
  const clock = new SimulationClock({
    onFrame: (frame) => frames.push(frame),
    onFinish: () => complete++,
    requestFrame: (callback) => {
      next = callback;
      return 1;
    },
    cancelFrame: () => {
      next = null;
    },
    ...options,
  });
  return {
    clock,
    frames,
    step(timestamp) {
      const callback = next;
      next = null;
      callback?.(timestamp);
    },
    get complete() {
      return complete;
    },
    get scheduled() {
      return !!next;
    },
  };
}
test("continuous playback preserves integer epidemiological days and fractional visual progress", () => {
  const h = setup();
  h.clock.play();
  h.step(0);
  for (let t = 100; t <= 900; t += 100) h.step(t);
  assert.ok(Math.abs(h.clock.position - 0.5) < 1e-12);
  assert.equal(h.frames.at(-1).day, 0);
  assert.ok(Math.abs(h.frames.at(-1).fraction - 0.5) < 1e-12);
  for (let t = 1000; t <= 1800; t += 100) h.step(t);
  assert.ok(Math.abs(h.clock.position - 1) < 1e-12);
  assert.equal(h.frames.at(-1).day, 1);
});
test("pause and resume do not include elapsed wall time while stopped", () => {
  const h = setup();
  h.clock.play();
  h.step(0);
  h.step(100);
  h.clock.pause();
  const position = h.clock.position;
  assert.equal(h.scheduled, false);
  h.clock.play();
  h.step(90000);
  assert.equal(h.clock.position, position);
  h.step(90100);
  assert.ok(h.clock.position > position);
});
test("speed changes affect simulated time without changing the seeded model", () => {
  const h = setup();
  h.clock.setSpeed(2);
  h.clock.play();
  h.step(0);
  for (let t = 100; t <= 900; t += 100) h.step(t);
  assert.ok(Math.abs(h.clock.position - 1) < 1e-12);
  assert.throws(() => h.clock.setSpeed(10), RangeError);
});
test("seeking clamps to the horizon and completing stops scheduling frames", () => {
  const h = setup({ days: 2, dayDuration: 100 });
  h.clock.seek(99);
  assert.equal(h.clock.position, 2);
  h.clock.seek(-3);
  assert.equal(h.clock.position, 0);
  h.clock.play();
  h.step(0);
  h.step(100);
  h.step(200);
  assert.equal(h.clock.position, 2);
  assert.equal(h.clock.playing, false);
  assert.equal(h.scheduled, false);
  assert.equal(h.complete, 1);
});
test("a delayed animation frame cannot skip multiple model days", () => {
  const h = setup();
  h.clock.play();
  h.step(0);
  h.step(60000);
  assert.ok(h.clock.position < 0.1);
});
