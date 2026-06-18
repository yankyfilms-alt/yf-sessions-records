import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = resolve(root, "output", "yf-sessions-web.html");
const channelUrl = process.argv[2] || "https://www.youtube.com/@YFSessions";
const videosUrl = channelUrl.replace(/\/$/, "") + "/videos";

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim();
}

function describeVideo(title) {
  const cleanTitle = cleanText(title);
  return `Video oficial de YF Sessions Records: ${cleanTitle}. Produccion musical y visual del catalogo, disponible para reproducir directamente aqui.`;
}

const rawBuffer = execFileSync("yt-dlp", [
  "--no-update",
  "--flat-playlist",
  "--dump-single-json",
  "--playlist-end",
  "500",
  videosUrl
], { maxBuffer: 1024 * 1024 * 20 });

const raw = new TextDecoder("utf-8").decode(rawBuffer);
const playlist = JSON.parse(raw);
const videos = (playlist.entries || [])
  .filter((entry) => entry?.id && !String(entry.url || "").includes("/shorts/"))
  .filter((entry) => !entry.duration || Number(entry.duration) > 60)
  .map((entry) => ({
    title: cleanText(entry.title || "Video YF Sessions"),
    url: `https://www.youtube.com/watch?v=${entry.id}`,
    youtubeId: entry.id,
    channel: "YF Sessions",
    description: describeVideo(entry.title),
    thumb: `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
    duration: Math.round(Number(entry.duration || 0))
  }));

if (!videos.length) {
  throw new Error(`No se encontraron videos normales en ${videosUrl}`);
}

let html = readFileSync(htmlPath, "utf8");
const replacement = `const DEFAULT_YOUTUBE_VIDEOS = ${JSON.stringify(videos, null, 2)};`;
const markerStart = "const DEFAULT_YOUTUBE_VIDEOS = ";
const markerEnd = "const savedYoutubeVideos =";
const start = html.indexOf(markerStart);
const end = html.indexOf(markerEnd, start);
if (start === -1 || end === -1) {
  throw new Error("No se encontro el bloque DEFAULT_YOUTUBE_VIDEOS en el HTML");
}
html = `${html.slice(0, start)}${replacement}\n${html.slice(end)}`;
writeFileSync(htmlPath, html, "utf8");

console.log(`Videos actualizados: ${videos.length}`);
