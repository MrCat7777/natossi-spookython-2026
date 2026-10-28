/**
 * Render the geographic introduction from the same OpenStreetMap extract
 * used by the interactive experience. Requires @napi-rs/canvas and FFmpeg.
 * Set CANVAS_MODULE or FFMPEG_BIN when using a separate rendering toolchain.
 * The orange markers are illustrative animation, not observed case data.
 */
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createCanvas } = require(
  process.env.CANVAS_MODULE || "@napi-rs/canvas",
);
const directory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const map = JSON.parse(
  await readFile(path.join(directory, "dist/assets/manta-map.json"), "utf8"),
);
const WIDTH = 1600;
const HEIGHT = 900;
const FPS = 24;
const FRAMES = 192;
const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext("2d");
const [west, south, east, north] = map.bounds;
const centerLon = west + (east - west) * 0.47;
const centerLat = north - (north - south) * 0.46;
const geographicScale = 16000;

function project(point, progress) {
  const x = (point[0] - centerLon) * geographicScale;
  const y = (centerLat - point[1]) * geographicScale;
  const rotation = -0.19 + progress * 0.105;
  const rx = x * Math.cos(rotation) - y * Math.sin(rotation);
  const ry = x * Math.sin(rotation) + y * Math.cos(rotation);
  const zoom = 0.86 + progress * 0.3;
  const perspective = 1 / (1 + ry / 6000);
  return [
    WIDTH * (0.73 - progress * 0.025) + rx * perspective * zoom,
    HEIGHT * (0.52 + progress * 0.02) + ry * perspective * zoom * 0.69,
  ];
}

function line(points, progress) {
  if (!points || points.length < 2) return;
  ctx.beginPath();
  points.forEach((point, index) => {
    const [x, y] = project(point, progress);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
}

function circle(x, y, radius, color, opacity = 1) {
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function glow(x, y, radius, color, strength = 1) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(
    0,
    `${color}${Math.round(90 * strength)
      .toString(16)
      .padStart(2, "0")}`,
  );
  gradient.addColorStop(0.25, `${color}18`);
  gradient.addColorStop(1, `${color}00`);
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

const coastlines = map.coastlines || [];
const roads = map.roads || [];
const majorTypes = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
]);
const coast = [...coastlines].sort((a, b) => b.length - a.length)[0] || [];
const landmarks = map.landmarks || [];
const origin =
  landmarks.find((landmark) => /mercado/i.test(landmark.name)) || landmarks[0];
const originCoordinates = origin
  ? [origin.lon, origin.lat]
  : [west + (east - west) * 0.52, north - (north - south) * 0.25];
const particles = roads
  .filter((road, index) => index % 5 === 0 && road.points.length > 1)
  .slice(0, 155)
  .map((road, index) => {
    const point = road.points[Math.floor(road.points.length * 0.6)];
    return {
      point,
      phase: (index * 0.61803398875) % 1,
      distance: Math.hypot(
        point[0] - originCoordinates[0],
        point[1] - originCoordinates[1],
      ),
    };
  });
const routes = roads
  .filter((road, index) => majorTypes.has(road.type) && index % 7 === 0)
  .slice(0, 20);

function fillLand(progress) {
  const polygons = map.land || map.landPolygons || [];
  ctx.fillStyle = "#101f2b";
  if (polygons.length) {
    for (const polygon of polygons) {
      line(polygon, progress);
      ctx.closePath();
      ctx.fill();
    }
  } else if (coast.length) {
    // OSM coast has land on the left in way direction. Close its visible
    // section around the southern and eastern limits of this extract.
    const points = [...coast];
    const start = points[0];
    const end = points.at(-1);
    if (start[0] > end[0]) points.reverse();
    points.push([east + 0.1, south - 0.1], [west - 0.1, south - 0.1]);
    line(points, progress);
    ctx.closePath();
    ctx.fill();
  }
}

function render(progress, frame) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#050c13");
  background.addColorStop(0.55, "#091824");
  background.addColorStop(1, "#0d1c29");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // The survey grid sits behind cartography, anchored to geographic space.
  ctx.strokeStyle = "#73a4ba0c";
  ctx.lineWidth = 0.7;
  for (let lon = west - 0.1; lon < east + 0.1; lon += 0.012) {
    line(
      [
        [lon, south - 0.1],
        [lon, north + 0.1],
      ],
      progress,
    );
    ctx.stroke();
  }
  for (let lat = south - 0.1; lat < north + 0.1; lat += 0.012) {
    line(
      [
        [west - 0.1, lat],
        [east + 0.1, lat],
      ],
      progress,
    );
    ctx.stroke();
  }

  fillLand(progress);
  const landLighting = ctx.createRadialGradient(
    WIDTH * 0.78,
    HEIGHT * 0.6,
    30,
    WIDTH * 0.78,
    HEIGHT * 0.6,
    WIDTH * 0.65,
  );
  landLighting.addColorStop(0, "#b7d4e70a");
  landLighting.addColorStop(1, "#00000000");
  ctx.fillStyle = landLighting;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Layered coastline gives a subtle bathymetric contour without claiming
  // measured water depth. All road and shoreline coordinates remain real.
  for (const points of coastlines) {
    line(points, progress);
    ctx.lineWidth = 17;
    ctx.strokeStyle = "#6aaec307";
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#75b6cd0b";
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "#8bc5da99";
    ctx.stroke();
  }

  for (const road of roads) {
    const major = majorTypes.has(road.type);
    line(road.points, progress);
    ctx.strokeStyle = major ? "#91b2c957" : "#6f8da626";
    ctx.lineWidth = major
      ? road.type === "primary" || road.type === "trunk"
        ? 1.35
        : 0.9
      : 0.5;
    ctx.stroke();
  }

  const activity = Math.min(1, Math.max(0, (progress - 0.08) / 0.7));
  for (let index = 0; index < routes.length; index++) {
    const road = routes[index];
    const visible = Math.max(
      2,
      Math.floor(road.points.length * Math.min(1, activity * 1.5 + 0.1)),
    );
    line(road.points.slice(0, visible), progress);
    ctx.strokeStyle = `rgba(255,153,81,${0.12 + activity * 0.32})`;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    const tipIndex = Math.floor(
      (((frame / FRAMES) * 1.5 + index * 0.13) % 1) * (road.points.length - 1),
    );
    const [x, y] = project(road.points[tipIndex], progress);
    glow(x, y, 12, "#ff9a59", 0.7);
    circle(x, y, 1.7, "#ffc196", 0.6);
  }

  for (const particle of particles) {
    const reveal = Math.max(
      0,
      Math.min(
        1,
        (activity * 0.1 - particle.distance) * 100 + particle.phase * 0.45,
      ),
    );
    if (reveal <= 0) continue;
    const [x, y] = project(particle.point, progress);
    const pulse =
      0.8 + Math.sin(progress * Math.PI * 7 + particle.phase * 8) * 0.2;
    const controlled =
      progress > 0.76 && particle.phase < (progress - 0.76) * 2.5;
    const color = controlled ? "#71ded0" : "#ff8d4c";
    glow(x, y, 21 + particle.phase * 8, color, reveal * pulse * 0.7);
    circle(x, y, 1.8 + particle.phase * 1.3, color, reveal * pulse);
  }

  const [patientX, patientY] = project(originCoordinates, progress);
  glow(
    patientX,
    patientY,
    110 + activity * 90,
    "#ff6d2d",
    0.55 + activity * 0.35,
  );
  glow(patientX, patientY, 32, "#ff9b60", 0.8);
  circle(patientX, patientY, 4.5, "#ffad76");
  circle(patientX, patientY, 1.8, "#fff0df");
  for (let ring = 0; ring < 3; ring++) {
    const radius = 12 + ((progress * 0.9 + ring / 3) % 1) * 64;
    ctx.beginPath();
    ctx.ellipse(
      patientX,
      patientY,
      radius,
      radius * 0.67,
      -0.15,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = `rgba(255,147,82,${(1 - radius / 90) * 0.25})`;
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }

  // Leave generous negative space for the accessible HTML introduction.
  const leftFade = ctx.createLinearGradient(0, 0, WIDTH * 0.75, 0);
  leftFade.addColorStop(0, "#070b11");
  leftFade.addColorStop(0.3, "#070b11f2");
  leftFade.addColorStop(0.72, "#070b1166");
  leftFade.addColorStop(1, "#070b1100");
  ctx.fillStyle = leftFade;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const vignette = ctx.createRadialGradient(
    WIDTH * 0.68,
    HEIGHT * 0.54,
    HEIGHT * 0.12,
    WIDTH * 0.68,
    HEIGHT * 0.54,
    WIDTH * 0.8,
  );
  vignette.addColorStop(0, "#00000000");
  vignette.addColorStop(0.65, "#02060a24");
  vignette.addColorStop(1, "#02060ad9");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

const output = path.join(directory, "dist/assets/manta-intro.mp4");
const ffmpeg = spawn(
  process.env.FFMPEG_BIN || "ffmpeg",
  [
    "-y",
    "-f",
    "rawvideo",
    "-pixel_format",
    "rgba",
    "-video_size",
    `${WIDTH}x${HEIGHT}`,
    "-framerate",
    String(FPS),
    "-i",
    "-",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "29",
    "-maxrate",
    "6000k",
    "-bufsize",
    "6000k",
    "-g",
    "1",
    "-keyint_min",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    output,
  ],
  { stdio: ["pipe", "ignore", "pipe"] },
);
let diagnostics = "";
ffmpeg.stderr.on("data", (data) => {
  diagnostics += data.toString();
});
ffmpeg.stdin.on("error", () => {});
const finished = once(ffmpeg, "exit");

for (let frame = 0; frame < FRAMES; frame++) {
  const progress = frame / (FRAMES - 1);
  render(progress, frame);
  if (frame === 0) {
    await writeFile(
      path.join(directory, "dist/assets/manta-poster.webp"),
      await canvas.encode("webp", 88),
    );
  }
  const buffer = Buffer.from(ctx.getImageData(0, 0, WIDTH, HEIGHT).data.buffer);
  if (!ffmpeg.stdin.write(buffer)) await once(ffmpeg.stdin, "drain");
  if (frame % FPS === 0) process.stdout.write(`Rendered ${frame / FPS}s\n`);
}
ffmpeg.stdin.end();
const [code] = await finished;
if (code !== 0) throw new Error(diagnostics);
process.stdout.write(`Saved ${output}\n`);
