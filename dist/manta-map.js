const STATE_COLORS = ["#829fbd", "#d5bc85", "#ff9254", "#8ab9a2"];
const PLACE_ALIASES = { escuela: "uleam", transporte: "terminal" };
const SECTOR_PLACES = ["mercado", "uleam", "terminal", "tarqui"];

function randomAt(seed, index, channel = 0) {
  let value =
    (seed ^
      Math.imul(index + 1, 0x9e3779b1) ^
      Math.imul(channel + 1, 0x85ebca77)) >>>
    0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function insidePolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function roundedRect(context, x, y, width, height, radius = 3) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

/**
 * Offline cartography drawn from OpenStreetMap geometries.
 * Geographic roads and coastline are real; agent positions are illustrative.
 * Satellite imagery is photographic; people and their movement are synthetic.
 * Live rendering runs only while the outbreak canvas is visible and motion is allowed.
 */
export class MantaMap {
  constructor(canvas, data, { interactive = false, labels = true } = {}) {
    if (!canvas || !data?.bounds || !data?.roads)
      throw new TypeError("A canvas and Manta cartography are required.");
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.data = data;
    this.interactive = interactive;
    this.labels = labels;
    this.focus = "mercado";
    this.zoom = 1;
    this.isOutbreak = canvas.id === "outbreak-map";
    this.result = null;
    this.day = 0;
    this.strategy = "strategic";
    this.destroyed = false;
    this.pendingFrame = null;
    this.liveFrame = null;
    this.liveEnabled = true;
    this.visible = false;
    this.lastLivePaint = 0;
    this.animationTime = 0;
    this.avatarCache = new Map();
    this.motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    this.width = 0;
    this.height = 0;
    this.base = document.createElement("canvas");
    this.baseContext = this.base.getContext("2d");
    this.places = new Map(data.landmarks.map((place) => [place.id, place]));
    this.roadPoints = data.roads.flatMap((road) => road.points);
    this.positions = [];
    this.resize = this.resize.bind(this);
    this.scheduleDraw = this.scheduleDraw.bind(this);
    this.updateLive = this.updateLive.bind(this);
    this.paintLive = this.paintLive.bind(this);
    this.satellite = new Image();
    this.satellite.decoding = "async";
    this.satellite.onload = () => {
      if (this.destroyed) return;
      this.drawBase();
      this.scheduleDraw();
    };
    this.satellite.src = "./assets/manta-satellite.webp";
    this.motionPreference.addEventListener("change", this.updateLive);
    document.addEventListener("visibilitychange", this.updateLive);
    if ("IntersectionObserver" in window) {
      this.visibilityObserver = new IntersectionObserver(
        (entries) => {
          this.visible = entries.some(
            (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.1,
          );
          this.updateLive();
        },
        { threshold: [0, 0.1] },
      );
      this.visibilityObserver.observe(canvas);
    } else this.visible = true;
    if ("ResizeObserver" in window) {
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(canvas);
    } else window.addEventListener("resize", this.resize, { passive: true });
    this.resize();
    document.fonts?.ready.then(() => {
      if (!this.destroyed) this.scheduleDraw();
    });
  }

  setFocus(placeId) {
    const normalized = PLACE_ALIASES[placeId] || placeId;
    if (this.places.has(normalized)) this.focus = normalized;
    if (this.width && this.height) {
      this.configureProjection();
      this.drawBase();
    }
    this.scheduleDraw();
  }

  setSimulation(result) {
    this.result = result;
    this.isOutbreak = true;
    this.day = 0;
    this.strategy = "strategic";
    this.focus = PLACE_ALIASES[result?.origin] || result?.origin || this.focus;
    this.buildAgentPositions();
    if (this.width && this.height) this.configureProjection();
    this.drawBase();
    this.scheduleDraw();
    this.updateLive();
  }

  setLive(enabled) {
    this.liveEnabled = Boolean(enabled);
    this.updateLive();
    this.scheduleDraw();
  }

  setZoom(level) {
    const requested = Number(level);
    this.zoom = Number.isFinite(requested)
      ? Math.max(1, Math.min(3, Math.round(requested)))
      : 1;
    if (this.width && this.height) {
      this.configureProjection();
      this.drawBase();
    }
    this.scheduleDraw();
    return this.zoom;
  }

  updateLive() {
    const active =
      !this.destroyed &&
      this.isOutbreak &&
      this.result &&
      this.visible &&
      this.liveEnabled &&
      !document.hidden &&
      !this.motionPreference.matches;
    if (active && this.liveFrame === null)
      this.liveFrame = requestAnimationFrame(this.paintLive);
    else if (!active && this.liveFrame !== null) {
      cancelAnimationFrame(this.liveFrame);
      this.liveFrame = null;
    }
  }

  paintLive(timestamp) {
    this.liveFrame = null;
    if (
      this.destroyed ||
      !this.visible ||
      !this.liveEnabled ||
      document.hidden ||
      this.motionPreference.matches
    )
      return;
    if (timestamp - this.lastLivePaint >= 1000 / 30) {
      this.lastLivePaint = timestamp;
      this.animationTime = timestamp / 1000;
      this.draw();
    }
    this.updateLive();
  }

  setDay(day, strategy = "strategic") {
    this.day = Math.max(
      0,
      Math.min(this.result?.days ?? 30, Math.round(Number(day) || 0)),
    );
    this.strategy = ["strategic", "random", "baseline"].includes(strategy)
      ? strategy
      : "strategic";
    this.scheduleDraw();
  }

  resize() {
    if (this.destroyed) return;
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (
      bounds.width === this.width &&
      bounds.height === this.height &&
      dpr === this.dpr
    )
      return;
    this.width = bounds.width;
    this.height = bounds.height;
    this.dpr = dpr;
    this.canvas.width = this.base.width = Math.round(this.width * dpr);
    this.canvas.height = this.base.height = Math.round(this.height * dpr);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.baseContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.configureProjection();
    this.drawBase();
    this.scheduleDraw();
  }

  configureProjection() {
    const [west, south, east, north] = this.data.bounds;
    // The useful urban strip keeps the shoreline, port and all six landmarks.
    // On portrait screens the full longitude range remains in view.
    const viewSouth = Math.max(south, -0.982);
    const viewNorth = Math.min(north, -0.923);
    const longitudeSpan = east - west;
    const latitudeSpan = viewNorth - viewSouth;
    const padding = this.width < 480 ? 18 : this.isOutbreak ? 30 : 42;
    this.scale = Math.min(
      (this.width - padding * 2) / longitudeSpan,
      (this.height - padding * 2) / latitudeSpan,
    );
    this.centerLongitude = (west + east) / 2;
    this.centerLatitude = (viewSouth + viewNorth) / 2;
    this.offsetX =
      this.width / 2 +
      (!this.isOutbreak && this.width > 850 ? this.width * 0.065 : 0);
    this.offsetY =
      this.height / 2 +
      (!this.isOutbreak && this.width < 600 ? -this.height * 0.09 : 0);
    if (this.zoom > 1) {
      const focus = this.places.get(this.focus);
      if (focus) {
        this.centerLongitude = focus.lon;
        this.centerLatitude = focus.lat;
      }
      this.scale *= this.zoom === 2 ? 1.8 : 2.8;
      this.offsetX = this.width / 2;
      this.offsetY = this.height / 2;
    }
  }

  project(point) {
    return [
      this.offsetX + (point[0] - this.centerLongitude) * this.scale,
      this.offsetY - (point[1] - this.centerLatitude) * this.scale,
    ];
  }

  trace(context, points, close = false) {
    if (!points?.length) return;
    const first = this.project(points[0]);
    context.moveTo(first[0], first[1]);
    for (let i = 1; i < points.length; i++) {
      const point = this.project(points[i]);
      context.lineTo(point[0], point[1]);
    }
    if (close) context.closePath();
  }

  drawBase() {
    if (!this.width || !this.height) return;
    const ctx = this.baseContext;
    const { width, height } = this;
    ctx.clearRect(0, 0, width, height);
    const sea = ctx.createLinearGradient(0, 0, width, height);
    sea.addColorStop(0, "#081623");
    sea.addColorStop(0.65, "#0b1a28");
    sea.addColorStop(1, "#0a1723");
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.strokeStyle = "rgba(111,151,180,.05)";
    ctx.lineWidth = 0.65;
    for (let x = 0; x <= width; x += 42) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += 42) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.beginPath();
    for (const polygon of this.data.land || []) this.trace(ctx, polygon, true);
    const ground = ctx.createLinearGradient(0, 0, width, height);
    ground.addColorStop(0, "#182b3b");
    ground.addColorStop(1, "#132333");
    ctx.fillStyle = ground;
    ctx.fill();

    if (this.satellite.complete && this.satellite.naturalWidth) {
      const [west, south, east, north] = this.data.bounds;
      const northwest = this.project([west, north]);
      const southeast = this.project([east, south]);
      ctx.save();
      ctx.filter = "saturate(.76) contrast(1.12) brightness(.88)";
      ctx.drawImage(
        this.satellite,
        northwest[0],
        northwest[1],
        southeast[0] - northwest[0],
        southeast[1] - northwest[1],
      );
      ctx.filter = "none";
      ctx.fillStyle = "rgba(8,20,32,.20)";
      ctx.fillRect(
        northwest[0],
        northwest[1],
        southeast[0] - northwest[0],
        southeast[1] - northwest[1],
      );
      ctx.restore();
    }

    const roadGroups = new Map();
    for (const road of this.data.roads) {
      const type = road.type.replace(/_link$/, "");
      if (!roadGroups.has(type)) roadGroups.set(type, []);
      roadGroups.get(type).push(road);
    }
    const colors = {
      residential: "rgba(180,205,220,.07)",
      tertiary: "rgba(185,212,229,.12)",
      secondary: "rgba(195,220,235,.18)",
      primary: "rgba(210,232,245,.24)",
      trunk: "rgba(195,220,238,.24)",
      motorway: "rgba(195,220,238,.24)",
    };
    for (const [type, roads] of roadGroups) {
      ctx.beginPath();
      for (const road of roads) this.trace(ctx, road.points);
      ctx.strokeStyle = colors[type] || colors.residential;
      ctx.lineWidth =
        type === "residential" ? 0.5 : type === "tertiary" ? 0.7 : 1;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
    }

    ctx.beginPath();
    for (const coast of this.data.coastlines) this.trace(ctx, coast);
    ctx.strokeStyle = "rgba(106,173,203,.11)";
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = "rgba(143,194,214,.57)";
    ctx.lineWidth = 0.9;
    ctx.stroke();

    const oceanPosition = this.project([-80.762, -0.935]);
    ctx.save();
    ctx.translate(oceanPosition[0], oceanPosition[1]);
    ctx.rotate(-0.14);
    ctx.fillStyle = "rgba(117,156,181,.31)";
    ctx.font = `500 ${width < 600 ? 8 : 10}px 'DM Sans', sans-serif`;
    ctx.letterSpacing = "3px";
    ctx.textAlign = "center";
    ctx.fillText("OCÉANO PACÍFICO", 0, 0);
    ctx.restore();

    // Soft framing masks the finite data extent without adding fictitious roads.
    const vignette = ctx.createRadialGradient(
      width * 0.58,
      height * 0.46,
      height * 0.1,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.65,
    );
    vignette.addColorStop(0, "rgba(5,13,23,0)");
    vignette.addColorStop(1, "rgba(5,13,23,.55)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  buildAgentPositions() {
    const nodes = this.result?.network?.nodes;
    if (!nodes) {
      this.positions = [];
      return;
    }
    const onLand = (point) =>
      !this.data.land?.length ||
      this.data.land.some((polygon) => insidePolygon(point, polygon));
    const candidates = SECTOR_PLACES.map((id) => {
      const anchor = this.places.get(id);
      if (!anchor) return [];
      return this.roadPoints.filter(
        (point) =>
          Math.hypot(point[0] - anchor.lon, point[1] - anchor.lat) < 0.013 &&
          onLand(point),
      );
    });
    this.positions = nodes.map((node, index) => {
      const sector = Math.max(0, Math.min(3, node.sector || 0));
      const anchor =
        this.places.get(SECTOR_PLACES[sector]) || this.data.landmarks[0];
      if (node.id < 4) return [anchor.lon, anchor.lat];
      const household = Math.floor((node.id - 4) / 5);
      const pool = candidates[sector];
      const candidate = pool.length
        ? pool[
            Math.floor(randomAt(this.result.seed, household, 9) * pool.length)
          ]
        : [anchor.lon, anchor.lat];
      const angle = randomAt(this.result.seed, index, 3) * Math.PI * 2;
      const radius = 0.00008 + randomAt(this.result.seed, index, 5) * 0.0003;
      const position = [
        candidate[0] + Math.cos(angle) * radius,
        candidate[1] + Math.sin(angle) * radius,
      ];
      return onLand(position) ? position : candidate;
    });
  }

  avatarStamp(state, style, frame) {
    const key = `${state}:${style}:${frame}`;
    if (this.avatarCache.has(key)) return this.avatarCache.get(key);
    const stamp = document.createElement("canvas");
    stamp.width = 64;
    stamp.height = 80;
    const ctx = stamp.getContext("2d");
    ctx.scale(2, 2);
    ctx.translate(16, 32);
    const zombie = state === 2;
    const phase = (frame / 8) * Math.PI * 2;
    const stride = Math.sin(phase) * (zombie ? 2 : 2.5);
    const bodyTilt = zombie ? 1.4 : 0;
    const clothes = zombie
      ? ["#637b54", "#735f4b", "#5b6d5f", "#6e6554"][style]
      : state === 1
        ? ["#b89a67", "#a89475", "#c6a36c", "#8b856b"][style]
        : ["#617a96", "#9c8c7c", "#7e7790", "#778e85"][style];
    const skin = zombie
      ? "#a0aa78"
      : ["#d2a486", "#bc8b6d", "#e0b99d", "#b88f74"][style];
    // Elliptical ground shadow and oblique, shaded body give small agents a
    // readable human shape without pretending to be observed satellite people.
    ctx.fillStyle = "rgba(0,0,0,.52)";
    ctx.beginPath();
    ctx.ellipse(1.5, 1, 5.2, 1.9, -0.12, 0, Math.PI * 2);
    ctx.fill();
    if (state === 3) {
      ctx.strokeStyle = "rgba(126,225,188,.7)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(0, 0.3, 6.6, 2.3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Legs separate as the gait changes, with dark shoes anchoring each foot.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = zombie ? "#38413a" : "#29384a";
    ctx.lineWidth = 2.3;
    ctx.beginPath();
    ctx.moveTo(-1.7, -8);
    ctx.lineTo(-2.4 - stride * 0.45, -3.5);
    ctx.lineTo(-2.2 + stride * 0.65, 0);
    ctx.moveTo(1.4, -8);
    ctx.lineTo(2 + stride * 0.45, -3.5);
    ctx.lineTo(2 - stride * 0.65, 0);
    ctx.stroke();
    ctx.strokeStyle = "#111e2a";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-2.4 + stride * 0.65, 0);
    ctx.lineTo(-0.5 + stride * 0.65, 0.3);
    ctx.moveTo(1.8 - stride * 0.65, 0);
    ctx.lineTo(3.6 - stride * 0.65, 0.3);
    ctx.stroke();
    // The far arm is partly hidden by the torso. Zombies reach forward.
    ctx.strokeStyle = clothes;
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(-2.7 + bodyTilt, -15.5);
    ctx.lineTo(zombie ? 1 : -4.1, -11.5 + (zombie ? -0.5 : stride * 0.5));
    ctx.lineTo(zombie ? 5 : -3.5, -10 + (zombie ? -3 : stride));
    ctx.stroke();
    ctx.strokeStyle = skin;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(zombie ? 5 : -3.5, -10 + (zombie ? -3 : stride));
    ctx.lineTo(zombie ? 7 : -3, -9 + (zombie ? -4 : stride));
    ctx.stroke();
    const torso = ctx.createLinearGradient(-4, -18, 4, -9);
    torso.addColorStop(0, clothes);
    torso.addColorStop(1, zombie ? "#414b3b" : "#405267");
    ctx.fillStyle = torso;
    ctx.beginPath();
    ctx.moveTo(-2.5 + bodyTilt, -17);
    ctx.quadraticCurveTo(0 + bodyTilt, -19, 2.8 + bodyTilt, -16.5);
    ctx.lineTo(2, -8.2);
    ctx.quadraticCurveTo(0, -6.8, -2.4, -8.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.15)";
    ctx.beginPath();
    ctx.moveTo(-2 + bodyTilt, -16);
    ctx.lineTo(-0.8 + bodyTilt, -16.8);
    ctx.lineTo(-0.5, -9.5);
    ctx.lineTo(-1.9, -10);
    ctx.fill();
    // Near arm swings in the opposite direction to the near leg.
    ctx.strokeStyle = clothes;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(2.6 + bodyTilt, -16);
    ctx.lineTo(zombie ? 5.3 : 4.1, -12.4 + (zombie ? -1.4 : -stride * 0.5));
    ctx.lineTo(zombie ? 8 : 3.9, -10.5 + (zombie ? -4 : -stride));
    ctx.stroke();
    ctx.strokeStyle = skin;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(zombie ? 8 : 3.9, -10.5 + (zombie ? -4 : -stride));
    ctx.lineTo(zombie ? 10 : 3.8, -9.2 + (zombie ? -5 : -stride));
    ctx.stroke();
    // Neck, head, hair and one light edge keep faces dimensional at small scale.
    ctx.fillStyle = skin;
    ctx.fillRect(-0.8 + bodyTilt, -20.2, 2.1, 3);
    ctx.beginPath();
    ctx.ellipse(
      0.1 + bodyTilt,
      -22,
      2.7,
      3.3,
      zombie ? 0.13 : -0.08,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = zombie
      ? "#4a5140"
      : ["#2e2726", "#392c24", "#49382e", "#242626"][style];
    ctx.beginPath();
    ctx.ellipse(-0.25 + bodyTilt, -23.2, 2.65, 2, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,238,207,.45)";
    ctx.beginPath();
    ctx.ellipse(1.2 + bodyTilt, -22, 0.7, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    if (zombie) {
      ctx.fillStyle = "#edb36c";
      ctx.fillRect(1.5 + bodyTilt, -22.4, 0.8, 0.65);
      ctx.fillStyle = "#374735";
      ctx.fillRect(-1, -11, 1.3, 2.7);
    }
    if (state === 1) {
      ctx.fillStyle = "#ffc578";
      ctx.beginPath();
      ctx.arc(0, -28.4, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    this.avatarCache.set(key, stamp);
    return stamp;
  }

  drawAgents() {
    const ctx = this.context;
    const timeline = this.result?.timeline?.[this.strategy];
    const states = timeline?.[Math.min(this.day, (timeline?.length || 1) - 1)];
    if (!states || !this.positions.length) return;
    const motionAllowed = !this.motionPreference.matches;
    const time = motionAllowed ? this.animationTime : 0;
    const projected = this.positions.map((position, index) => {
      const [x, y] = this.project(position);
      const phase = randomAt(this.result.seed, index, 32) * Math.PI * 2;
      // Sub-pixel walking and household separation are visual only. Contact
      // edges and epidemiological states remain fixed by the seeded model.
      const separation =
        index < 4 ? 0 : 3 + randomAt(this.result.seed, index, 33) * 5;
      return [
        x + Math.cos(phase) * separation + Math.sin(time * 0.35 + phase) * 1.2,
        y +
          Math.sin(phase) * separation * 0.6 +
          Math.cos(time * 0.3 + phase) * 0.6,
      ];
    });
    const edges = this.result.network.edges || [];
    ctx.save();
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    edges.forEach(([a, b], index) => {
      if (index % 5 || !projected[a] || !projected[b]) return;
      ctx.moveTo(...projected[a]);
      ctx.lineTo(...projected[b]);
    });
    ctx.strokeStyle = "rgba(129,162,189,.055)";
    ctx.stroke();
    ctx.beginPath();
    edges.forEach(([a, b], index) => {
      if (
        index % 3 ||
        (states[a] !== 2 && states[b] !== 2) ||
        !projected[a] ||
        !projected[b]
      )
        return;
      ctx.moveTo(...projected[a]);
      ctx.lineTo(...projected[b]);
    });
    ctx.strokeStyle = "rgba(255,146,84,.15)";
    ctx.stroke();
    // Depth sort preserves the silhouettes in small crowds; no live state is
    // invented by the renderer. Every figure is one synthetic model agent.
    const order = projected
      .map((point, index) => ({ point, index }))
      .sort((a, b) => a.point[1] - b.point[1]);
    for (const {
      point: [x, y],
      index,
    } of order) {
      if (x < -20 || y < -20 || x > this.width + 20 || y > this.height + 30)
        continue;
      const state = states[index];
      const style = index % 4;
      const phase = randomAt(this.result.seed, index, 40);
      const frame = motionAllowed
        ? Math.floor((time * (state === 2 ? 3.2 : 5.2) + phase * 8) % 8)
        : 0;
      if (state === 2 || state === 1) {
        const pulse = 0.7 + Math.sin(time * 2 + phase * 8) * 0.17;
        const glow = ctx.createRadialGradient(
          x,
          y - 5,
          1,
          x,
          y - 5,
          state === 2 ? 15 : 9,
        );
        glow.addColorStop(
          0,
          `rgba(${state === 2 ? "255,135,69" : "255,205,120"},${0.22 * pulse})`,
        );
        glow.addColorStop(1, "rgba(255,146,84,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(x - 16, y - 21, 32, 32);
      }
      const personScale =
        (index < 4 ? 1.06 : this.width < 500 ? 0.79 : 0.87) *
        (1 + 0.2 * (this.zoom - 1));
      const stamp = this.avatarStamp(state, style, frame);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(
        randomAt(this.result.seed, index, 42) > 0.5
          ? personScale
          : -personScale,
        personScale,
      );
      ctx.globalAlpha = state === 0 ? 0.9 : 1;
      ctx.drawImage(stamp, -12.8, -25.6, 25.6, 32);
      ctx.restore();
    }
    ctx.restore();
  }

  labelObstacles() {
    const { width, height } = this;
    if (this.isOutbreak)
      return [
        { x: 0, y: 0, width, height: 44 },
        { x: 0, y: height - 85, width: 145, height: 85 },
        { x: width - 145, y: height - 75, width: 145, height: 75 },
      ];
    return [
      { x: 0, y: 0, width, height: width < 700 ? 104 : 75 },
      { x: 0, y: height - 240, width: width < 600 ? width : 335, height: 240 },
    ];
  }

  drawLabels() {
    const ctx = this.context;
    const occupied = this.labelObstacles();
    const fontSize = this.width < 500 ? 10 : 11;
    ctx.save();
    ctx.font = `500 ${fontSize}px 'DM Sans', sans-serif`;
    ctx.textBaseline = "middle";
    const places = [...this.data.landmarks].sort(
      (a, b) => Number(b.id === this.focus) - Number(a.id === this.focus),
    );
    for (const place of places) {
      const [x, y] = this.project([place.lon, place.lat]);
      const active = place.id === this.focus;
      if (x < 10 || x > this.width - 10 || y < 10 || y > this.height - 10)
        continue;
      if (!this.isOutbreak || active) {
        // Preserve the actual SEIR color at the origin on the outbreak map.
        if (!this.isOutbreak) {
          ctx.fillStyle = active ? "#ffb184" : "#9bb6ce";
          ctx.shadowColor = active ? "#ff9254" : "transparent";
          ctx.shadowBlur = active ? 14 : 0;
          ctx.beginPath();
          ctx.arc(x, y, active ? 3.5 : 2.3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
        ctx.strokeStyle = active
          ? "rgba(255,146,84,.36)"
          : "rgba(155,182,206,.18)";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(x, y, active ? 11 : 6.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (!this.labels) continue;
      const text =
        place.id === "mercado"
          ? "Mercado central"
          : place.id === "terminal"
            ? "Terminal terrestre"
            : place.name;
      const labelWidth = ctx.measureText(text).width + 17;
      const labelHeight = 24;
      const candidates = [
        { x: x + 11, y: y - 31 },
        { x: x + 11, y: y + 9 },
        { x: x - labelWidth - 11, y: y - 31 },
        { x: x - labelWidth - 11, y: y + 9 },
        { x: x - labelWidth / 2, y: y - 43 },
        { x: x - labelWidth / 2, y: y + 19 },
      ].map((box) => ({ ...box, width: labelWidth, height: labelHeight }));
      const box = candidates.find(
        (candidate) =>
          candidate.x >= 9 &&
          candidate.x + candidate.width <= this.width - 9 &&
          candidate.y >= 9 &&
          candidate.y + candidate.height <= this.height - 20 &&
          !occupied.some((obstacle) => overlaps(candidate, obstacle)),
      );
      if (!box) continue;
      occupied.push({
        x: box.x - 4,
        y: box.y - 4,
        width: box.width + 8,
        height: box.height + 8,
      });
      roundedRect(ctx, box.x, box.y, box.width, box.height);
      ctx.fillStyle = "rgba(8,19,31,.89)";
      ctx.fill();
      ctx.strokeStyle = active
        ? "rgba(255,146,84,.48)"
        : "rgba(143,173,198,.22)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.fillStyle = active ? "#ffc29d" : "#bdcddd";
      ctx.fillText(text, box.x + 8, box.y + labelHeight / 2);
    }
    ctx.restore();
  }

  scheduleDraw() {
    if (this.destroyed || this.pendingFrame !== null) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = null;
      this.draw();
    });
  }

  draw() {
    if (this.destroyed || !this.width) return;
    const ctx = this.context;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.base, 0, 0, this.width, this.height);
    if (this.result) this.drawAgents();
    this.drawLabels();
  }

  destroy() {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.visibilityObserver?.disconnect();
    window.removeEventListener("resize", this.resize);
    this.motionPreference.removeEventListener("change", this.updateLive);
    document.removeEventListener("visibilitychange", this.updateLive);
    if (this.pendingFrame !== null) cancelAnimationFrame(this.pendingFrame);
    if (this.liveFrame !== null) cancelAnimationFrame(this.liveFrame);
    this.pendingFrame = null;
    this.liveFrame = null;
    this.satellite.onload = null;
    this.avatarCache.clear();
  }
}
