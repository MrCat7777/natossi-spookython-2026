/** A continuous presentation clock. Epidemiological states stay on integer days. */
export class SimulationClock {
  constructor({
    onFrame,
    onFinish = () => {},
    days = 30,
    dayDuration = 1800,
    requestFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (id) => cancelAnimationFrame(id),
  }) {
    this.onFrame = onFrame;
    this.onFinish = onFinish;
    this.days = days;
    this.dayDuration = dayDuration;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.position = 0;
    this.speed = 1;
    this.playing = false;
    this.frame = null;
    this.lastTime = null;
    this.tick = this.tick.bind(this);
  }
  seek(position) {
    this.position = Math.max(0, Math.min(this.days, Number(position) || 0));
    this.lastTime = null;
    this.emit();
  }
  setSpeed(speed) {
    if (![0.5, 1, 2].includes(Number(speed)))
      throw new RangeError("Unsupported playback speed");
    this.speed = Number(speed);
  }
  play() {
    if (this.playing) return;
    if (this.position >= this.days) this.seek(0);
    this.playing = true;
    this.lastTime = null;
    this.frame = this.requestFrame(this.tick);
  }
  pause() {
    this.playing = false;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.lastTime = null;
  }
  tick(timestamp) {
    this.frame = null;
    if (!this.playing) return;
    if (this.lastTime !== null) {
      // Background tabs do not jump whole days when the browser resumes.
      this.position = Math.min(
        this.days,
        this.position +
          (Math.min(100, Math.max(0, timestamp - this.lastTime)) * this.speed) /
            this.dayDuration,
      );
    }
    this.lastTime = timestamp;
    this.emit();
    if (this.position >= this.days) {
      this.pause();
      this.onFinish();
    } else this.frame = this.requestFrame(this.tick);
  }
  emit() {
    const day = Math.floor(this.position);
    this.onFrame({
      position: this.position,
      day,
      fraction: this.position - day,
      playing: this.playing,
    });
  }
}
