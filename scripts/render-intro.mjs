/**
 * Natossi: a 24-second geographic introduction rendered from real Manta imagery.
 * Requires @napi-rs/canvas and FFmpeg. CANVAS_MODULE and FFMPEG_BIN may point
 * to a separate rendering toolchain. Imagery credit: Esri, Vantor, Earthstar
 * Geographics, and the GIS User Community. Road data: OpenStreetMap contributors.
 * Orange and green activity is illustrative, never observed case data.
 */
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require(
  process.env.CANVAS_MODULE || "@napi-rs/canvas",
);
const directory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const map = JSON.parse(
  await readFile(path.join(directory, "dist/assets/manta-map.json"), "utf8"),
);
const satelliteMetadata = JSON.parse(
  await readFile(
    path.join(directory, "dist/assets/manta-satellite.json"),
    "utf8",
  ),
);
const satellite = await loadImage(
  path.join(directory, "dist/assets/manta-satellite.webp"),
);
const WIDTH = 1920,
  HEIGHT = 1080,
  FPS = 24,
  SECONDS = 24,
  FRAMES = FPS * SECONDS;
const canvas = createCanvas(WIDTH, HEIGHT),
  ctx = canvas.getContext("2d");
const [west, south, east, north] = satelliteMetadata.bounds;
const centerLon = west + (east - west) * 0.49;
const centerLat = north - (north - south) * 0.44;
const majorTypes = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
]);
const majorRoads = map.roads.filter((road) => majorTypes.has(road.type));
const origin = map.landmarks.find((place) => place.id === "mercado");
const originPoint = [origin.lon, origin.lat];
const smooth = (value) => {
  const p = Math.max(0, Math.min(1, value));
  return p * p * (3 - 2 * p);
};

function project(point, progress) {
  const zoomIn = smooth(progress / 0.52);
  const settle = smooth((progress - 0.78) / 0.22);
  const rotation = -0.16 + progress * 0.21;
  const x = (point[0] - centerLon) * 18600;
  const y = (centerLat - point[1]) * 18600;
  const rx = x * Math.cos(rotation) - y * Math.sin(rotation);
  const ry = x * Math.sin(rotation) + y * Math.cos(rotation);
  const zoom = 0.98 + zoomIn * 0.38 - settle * 0.12;
  const perspective = 1 / (1 + ry / 7600);
  return [
    WIDTH * (0.735 - progress * 0.055) + rx * perspective * zoom,
    HEIGHT * (0.53 + progress * 0.045) + ry * perspective * zoom * 0.77,
  ];
}
function trace(points, progress) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const [x, y] = project(point, progress);
    index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
}
function circle(x, y, r, color, opacity = 1) {
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}
function glow(x, y, r, color, opacity = 0.6) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
  gradient.addColorStop(
    0,
    `${color}${Math.round(opacity * 120)
      .toString(16)
      .padStart(2, "0")}`,
  );
  gradient.addColorStop(0.3, `${color}18`);
  gradient.addColorStop(1, `${color}00`);
  ctx.fillStyle = gradient;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// Perspective is applied to an equirectangular geographic mesh. Each source
// triangle is mapped by its exact lon/lat corners; imagery and OSM stay aligned.
const mesh = [];
const COLUMNS = 4,
  ROWS = 3;
for (let row = 0; row < ROWS; row++)
  for (let col = 0; col < COLUMNS; col++) {
    const u0 = col / COLUMNS,
      u1 = (col + 1) / COLUMNS,
      v0 = row / ROWS,
      v1 = (row + 1) / ROWS;
    const a = {
      s: [u0 * satellite.width, v0 * satellite.height],
      g: [west + u0 * (east - west), north - v0 * (north - south)],
    };
    const b = {
      s: [u1 * satellite.width, v0 * satellite.height],
      g: [west + u1 * (east - west), north - v0 * (north - south)],
    };
    const c = {
      s: [u1 * satellite.width, v1 * satellite.height],
      g: [west + u1 * (east - west), north - v1 * (north - south)],
    };
    const d = {
      s: [u0 * satellite.width, v1 * satellite.height],
      g: [west + u0 * (east - west), north - v1 * (north - south)],
    };
    mesh.push([a, b, c], [a, c, d]);
  }
function drawTriangle(vertices, progress) {
  const [[x0, y0], [x1, y1], [x2, y2]] = vertices.map((v) => v.s);
  const [[X0, Y0], [X1, Y1], [X2, Y2]] = vertices.map((v) =>
    project(v.g, progress),
  );
  const determinant = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
  const a = (X0 * (y1 - y2) + X1 * (y2 - y0) + X2 * (y0 - y1)) / determinant;
  const c = (X0 * (x2 - x1) + X1 * (x0 - x2) + X2 * (x1 - x0)) / determinant;
  const e =
    (X0 * (x1 * y2 - x2 * y1) +
      X1 * (x2 * y0 - x0 * y2) +
      X2 * (x0 * y1 - x1 * y0)) /
    determinant;
  const b = (Y0 * (y1 - y2) + Y1 * (y2 - y0) + Y2 * (y0 - y1)) / determinant;
  const d = (Y0 * (x2 - x1) + Y1 * (x0 - x2) + Y2 * (x1 - x0)) / determinant;
  const f =
    (Y0 * (x1 * y2 - x2 * y1) +
      Y1 * (x2 * y0 - x0 * y2) +
      Y2 * (x0 * y1 - x1 * y0)) /
    determinant;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(X0, Y0);
  ctx.lineTo(X1, Y1);
  ctx.lineTo(X2, Y2);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(satellite, 0, 0);
  ctx.restore();
}
const activityPoints = map.roads
  .filter((road, index) => index % 5 === 0 && road.points.length > 1)
  .slice(0, 220)
  .map((road, index) => {
    const point = road.points[Math.floor(road.points.length * 0.55)];
    return {
      point,
      phase: (index * 0.61803398875) % 1,
      distance: Math.hypot(
        point[0] - originPoint[0],
        point[1] - originPoint[1],
      ),
    };
  });
const routes = majorRoads.filter((road, index) => index % 6 === 0).slice(0, 30);
function render(progress, frame) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#05080e");
  background.addColorStop(1, "#0c1725");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.save();
  ctx.globalAlpha = 0.92;
  for (const triangle of mesh) drawTriangle(triangle, progress);
  ctx.restore();
  // A restrained night grade leaves the real roofs, coast and street texture readable.
  ctx.fillStyle = "#06101b44";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const haze = ctx.createRadialGradient(
    WIDTH * 0.85,
    HEIGHT * 0.25,
    0,
    WIDTH * 0.85,
    HEIGHT * 0.25,
    WIDTH * 0.8,
  );
  haze.addColorStop(0, "#4b2c6925");
  haze.addColorStop(1, "#0a142200");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (const road of majorRoads) {
    trace(road.points, progress);
    ctx.strokeStyle = road.type === "primary" ? "#b9cfdb38" : "#a7b5d016";
    ctx.lineWidth = road.type === "primary" ? 1.05 : 0.65;
    ctx.stroke();
  }
  for (const coast of map.coastlines) {
    trace(coast, progress);
    ctx.strokeStyle = "#b8e2ea77";
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
  const outbreak = smooth((progress - 0.12) / 0.43),
    control = smooth((progress - 0.61) / 0.31);
  for (let index = 0; index < routes.length; index++) {
    const road = routes[index],
      visible = Math.max(
        2,
        Math.floor(road.points.length * (0.12 + outbreak * 0.88)),
      );
    trace(road.points.slice(0, visible), progress);
    const protectedRoute = control > 0.3 && index % 3 === 0;
    ctx.strokeStyle = protectedRoute
      ? `rgba(107,228,184,${0.13 + control * 0.5})`
      : `rgba(255,146,75,${0.05 + outbreak * 0.23})`;
    ctx.lineWidth = protectedRoute ? 1.8 : 1.1;
    ctx.stroke();
    const tipIndex = Math.floor(
      ((progress * 1.7 + index * 0.13) % 1) * (road.points.length - 1),
    );
    const [x, y] = project(road.points[tipIndex], progress);
    const color = protectedRoute ? "#8eeed0" : "#ffaf76";
    glow(x, y, 14, color, 0.6);
    circle(x, y, 1.7, color, 0.8);
  }
  for (const point of activityPoints) {
    const reveal = Math.max(
      0,
      Math.min(1, (outbreak * 0.1 - point.distance) * 90 + point.phase * 0.18),
    );
    if (reveal <= 0) continue;
    const [x, y] = project(point.point, progress);
    const pulse = 0.77 + Math.sin((frame / FPS) * 1.4 + point.phase * 8) * 0.23;
    const protectedPoint = control > point.phase * 0.85 + 0.12;
    const color = protectedPoint ? "#83e7bb" : "#ff8d4c";
    glow(x, y, 22 + point.phase * 10, color, reveal * pulse * 0.55);
    circle(x, y, 1.7 + point.phase * 1.7, color, reveal * pulse);
  }
  const [px, py] = project(originPoint, progress);
  glow(px, py, 100 + outbreak * 70, "#ff6c38", 0.45 + outbreak * 0.25);
  glow(px, py, 29, "#ffb17d", 0.8);
  circle(px, py, 4.3, "#ffb17d");
  circle(px, py, 1.5, "#fff0e5");
  for (let ring = 0; ring < 3; ring++) {
    const radius = 15 + ((progress * 1.7 + ring / 3) % 1) * 85;
    ctx.beginPath();
    ctx.ellipse(px, py, radius, radius * 0.76, -0.1, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,149,88,${(1 - radius / 112) * 0.3})`;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  const vignette = ctx.createRadialGradient(
    WIDTH * 0.72,
    HEIGHT * 0.52,
    HEIGHT * 0.2,
    WIDTH * 0.72,
    HEIGHT * 0.52,
    WIDTH * 0.9,
  );
  vignette.addColorStop(0, "#02081200");
  vignette.addColorStop(0.72, "#03091035");
  vignette.addColorStop(1, "#030910e6");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const leftFade = ctx.createLinearGradient(0, 0, WIDTH * 0.74, 0);
  leftFade.addColorStop(0, "#070a11");
  leftFade.addColorStop(0.28, "#070a11f5");
  leftFade.addColorStop(0.6, "#070a11b3");
  leftFade.addColorStop(1, "#070a1100");
  ctx.fillStyle = leftFade;
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
    "fast",
    "-crf",
    "25",
    "-maxrate",
    "8000k",
    "-bufsize",
    "16000k",
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
  if (frame === 0)
    await writeFile(
      path.join(directory, "dist/assets/manta-poster.webp"),
      await canvas.encode("webp", 90),
    );
  const buffer = Buffer.from(ctx.getImageData(0, 0, WIDTH, HEIGHT).data.buffer);
  if (!ffmpeg.stdin.write(buffer)) await once(ffmpeg.stdin, "drain");
  if (frame % FPS === 0) process.stdout.write(`Rendered ${frame / FPS}s\n`);
}
ffmpeg.stdin.end();
const [code] = await finished;
if (code !== 0) throw new Error(diagnostics);
process.stdout.write(`Saved ${output}\n`);
