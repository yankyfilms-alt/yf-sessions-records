import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "output");
const dataDir = process.env.DATA_DIR || join(root, "data");
const dbPath = join(dataDir, "db.json");
const port = Number(process.env.PORT || 8093);
const adminEmail = (process.env.ADMIN_EMAIL || "admin@yfsessionsrecords.com").toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "YF2026!";
const sessions = new Map();

const defaultDb = {
  profile: {
    name: "YF Sessions",
    hero: "El catalogo oficial de YF Sessions - guaracha, dancehall, afro, flamenco urbano y mas. Todo el sonido, en un solo lugar.",
    bio: "YF Sessions es el sello musical de YF Sessions Records. Reggae-conscious, urban latin y R&B donde el artista nunca aparece en camara. La narrativa visual la llevan los modelos, con una paleta roja, ambar y dorada que define cada lanzamiento.",
    spotify: "https://open.spotify.com/artist/7cn2dOji4Io2WDx1SXH2mN",
    youtube: "https://www.youtube.com/@YFSessions",
    instagram: "YF Sessions HD",
    footer: "YF Sessions Records"
  },
  videos: [],
  photos: [],
  songs: [],
  contacts: [],
  stats: { visits: 0, spotifyClicks: 0, youtubeClicks: 0, clicks: {} }
};

const passwordSalt = process.env.ADMIN_PASSWORD_SALT || "yf-sessions-local-salt";
const passwordHash = scryptSync(adminPassword, passwordSalt, 64);

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function text(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

async function readDb() {
  await mkdir(dataDir, { recursive: true });
  try {
    return { ...defaultDb, ...JSON.parse(await readFile(dbPath, "utf8")) };
  } catch {
    await writeDb(defaultDb);
    return structuredClone(defaultDb);
  }
}

async function writeDb(db) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dbPath, JSON.stringify(db, null, 2), "utf8");
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [decodeURIComponent(key), decodeURIComponent(value.join("="))];
  }));
}

function isAuthed(req) {
  const sid = cookies(req).yf_session;
  const session = sid && sessions.get(sid);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sid);
    return false;
  }
  session.expiresAt = Date.now() + 1000 * 60 * 60 * 8;
  return true;
}

function requireAuth(req, res) {
  if (isAuthed(req)) return true;
  json(res, 401, { error: "No autorizado" });
  return false;
}

function validUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function sanitizeText(value, max = 2000) {
  return String(value || "").trim().slice(0, max);
}

async function handleApi(req, res, pathname) {
  const db = await readDb();

  if (req.method === "POST" && pathname === "/api/login") {
    const body = await parseBody(req);
    const email = sanitizeText(body.email).toLowerCase();
    const candidateHash = scryptSync(String(body.password || ""), passwordSalt, 64);
    const ok = email === adminEmail && timingSafeEqual(candidateHash, passwordHash);
    if (!ok) return json(res, 401, { error: "Credenciales incorrectas" });
    const sid = randomBytes(32).toString("hex");
    sessions.set(sid, { email, expiresAt: Date.now() + 1000 * 60 * 60 * 8 });
    return json(res, 200, { ok: true }, { "set-cookie": `yf_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` });
  }

  if (req.method === "POST" && pathname === "/api/logout") {
    const sid = cookies(req).yf_session;
    if (sid) sessions.delete(sid);
    return json(res, 200, { ok: true }, { "set-cookie": "yf_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
  }

  if (req.method === "GET" && pathname === "/api/session") {
    return json(res, 200, { authenticated: isAuthed(req) });
  }

  if (req.method === "GET" && pathname === "/api/public") {
    return json(res, 200, {
      profile: db.profile,
      videos: db.videos,
      photos: db.photos,
      songs: db.songs
    });
  }

  if (req.method === "POST" && pathname === "/api/visit") {
    db.stats.visits += 1;
    await writeDb(db);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/click") {
    const body = await parseBody(req);
    const label = sanitizeText(body.label, 120) || "Click";
    const type = sanitizeText(body.type, 20);
    if (type === "youtube") db.stats.youtubeClicks += 1;
    else db.stats.spotifyClicks += 1;
    db.stats.clicks[label] = (db.stats.clicks[label] || 0) + 1;
    await writeDb(db);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/contacts") {
    const body = await parseBody(req);
    const item = {
      id: randomBytes(8).toString("hex"),
      name: sanitizeText(body.name, 120),
      email: sanitizeText(body.email, 160),
      type: sanitizeText(body.type, 80),
      link: validUrl(body.link),
      message: sanitizeText(body.message, 2500),
      date: new Date().toLocaleString()
    };
    if (!item.name || !item.email || !item.message) return json(res, 400, { error: "Faltan campos requeridos" });
    db.contacts.unshift(item);
    await writeDb(db);
    return json(res, 201, { ok: true, contact: item });
  }

  if (pathname.startsWith("/api/admin/") && !requireAuth(req, res)) return;

  if (req.method === "GET" && pathname === "/api/admin/state") return json(res, 200, db);

  if (req.method === "PUT" && pathname === "/api/admin/profile") {
    const body = await parseBody(req);
    db.profile = {
      name: sanitizeText(body.name, 100) || defaultDb.profile.name,
      hero: sanitizeText(body.hero, 500),
      bio: sanitizeText(body.bio, 1600),
      spotify: validUrl(body.spotify) || defaultDb.profile.spotify,
      youtube: validUrl(body.youtube) || defaultDb.profile.youtube,
      instagram: sanitizeText(body.instagram, 100),
      footer: sanitizeText(body.footer, 100) || "YF Sessions Records"
    };
    await writeDb(db);
    return json(res, 200, { ok: true, profile: db.profile });
  }

  const collectionRoutes = {
    "/api/admin/videos": "videos",
    "/api/admin/photos": "photos",
    "/api/admin/songs": "songs"
  };
  if (collectionRoutes[pathname]) {
    const key = collectionRoutes[pathname];
    if (req.method === "POST") {
      const body = await parseBody(req);
      const item = { id: randomBytes(8).toString("hex"), ...body };
      db[key].unshift(item);
      await writeDb(db);
      return json(res, 201, { ok: true, item });
    }
    if (req.method === "DELETE") {
      const body = await parseBody(req);
      db[key] = db[key].filter((item) => item.id !== body.id);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }
  }

  if (req.method === "DELETE" && pathname === "/api/admin/contacts") {
    const body = await parseBody(req);
    db.contacts = body.id ? db.contacts.filter((item) => item.id !== body.id) : [];
    await writeDb(db);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/admin/reset-stats") {
    db.stats = structuredClone(defaultDb.stats);
    await writeDb(db);
    return json(res, 200, { ok: true, stats: db.stats });
  }

  json(res, 404, { error: "Endpoint no encontrado" });
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/yf-sessions-web.html" : pathname;
  const safePath = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return text(res, 403, "Prohibido");
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return text(res, 404, "No encontrado");
    const type = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".svg": "image/svg+xml"
    }[extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    createReadStream(filePath).pipe(res);
  } catch {
    text(res, 404, "No encontrado");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url.pathname);
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "Error interno" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`YF Sessions Records listo en http://127.0.0.1:${port}/yf-sessions-web.html`);
});
