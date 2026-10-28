/** Run after render-intro.mjs. Derives 60 fps delivery by blending the 24 fps render. */
import { spawn } from "node:child_process";
import { rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "dist/assets");
const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";
async function encode(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      ["-y", ...args, "-hide_banner", "-loglevel", "error"],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`FFmpeg exited with ${code}`)),
    );
  });
}
const hd = path.join(assets, "manta-intro-hd.mp4");
await encode([
  "-i",
  path.join(assets, "manta-intro.mp4"),
  "-vf",
  "minterpolate=fps=60:mi_mode=blend,scale=1920:1080:flags=lanczos",
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "fast",
  "-crf",
  "24",
  "-maxrate",
  "7000k",
  "-bufsize",
  "14000k",
  "-g",
  "6",
  "-keyint_min",
  "6",
  "-sc_threshold",
  "0",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  hd,
]);
const mobile = path.join(assets, "manta-intro-mobile.mp4");
await encode([
  "-i",
  hd,
  "-vf",
  "scale=1280:720:flags=lanczos",
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "fast",
  "-crf",
  "25",
  "-maxrate",
  "3500k",
  "-bufsize",
  "7000k",
  "-g",
  "6",
  "-keyint_min",
  "6",
  "-sc_threshold",
  "0",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  mobile,
]);
await rename(mobile, path.join(assets, "manta-intro.mp4"));
console.log("Encoded Full HD and mobile HD delivery.");
