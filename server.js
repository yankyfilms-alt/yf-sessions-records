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
const adminPassword = process.env.ADMIN_PASSWORD || "";
const sessions = new Map();
const loginAttempts = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const MAX_LOGIN_ATTEMPTS = 6;
const LOGIN_WINDOW_MS = 1000 * 60 * 15;

const defaultAdminAccounts = [
  {
    email: "macarenaperez.mp@icloud.com",
    salt: "b038f0995b5717284799faf6e7850ead",
    hash: "80c92b34c9e496faef4429074de2a5f2809ebbf4403c2b845c068c6634fb45ae99e0ed0f08c503d8cd5ae1adcbf2fa67375c43d1820963f817e382b5263ab55b"
  },
  {
    email: "yankyfilms@gmail.com",
    salt: "cc7d0f0a900d1ab9383890f370d78890",
    hash: "b01cfdaf18eb25951bc44932884b47ace3d28fd16a244539dae503ece882c11d2e0e09aba116e872c465d10ee1c5d8de883f7c5f9c1a62c545e4952bd0a8d10e"
  }
];

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
const passwordHash = adminPassword ? scryptSync(adminPassword, passwordSalt, 64) : null;

function loadAdminAccounts() {
  const accounts = [];
  if (process.env.ADMIN_ACCOUNTS_JSON) {
    try {
      const parsed = JSON.parse(process.env.ADMIN_ACCOUNTS_JSON);
      for (const account of parsed) {
        if (account.email && account.salt && account.hash) {
          accounts.push({
            email: String(account.email).toLowerCase(),
            salt: String(account.salt),
            hash: String(account.hash)
          });
        }
      }
    } catch (error) {
      console.error("ADMIN_ACCOUNTS_JSON invalido:", error.message);
    }
  }
  accounts.push(...defaultAdminAccounts);
  if (passwordHash) accounts.push({ email: adminEmail, salt: passwordSalt, hash: passwordHash.toString("hex") });
  return accounts;
}

const adminAccounts = loadAdminAccounts();

function securityHeaders(req, extra = {}) {
  const isHttps = req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted;
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "cross-origin-opener-policy": "same-origin",
    "cache-control": "no-store",
    ...(isHttps ? { "strict-transport-security": "max-age=31536000; includeSubDomains; preload" } : {}),
    ...extra
  };
}

function htmlSecurityHeaders(req, extra = {}) {
  return securityHeaders(req, {
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://i.scdn.co https://i.ytimg.com https://img.youtube.com",
      "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'"
    ].join("; "),
    ...extra
  });
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function text(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
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
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("PAYLOAD_TOO_LARGE");
    chunks.push(chunk);
  }
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
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

function requireAuth(req, res) {
  if (isAuthed(req)) return true;
  json(res, 401, { error: "No autorizado" }, securityHeaders(req));
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

function clientKey(req, email = "") {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.socket.remoteAddress || "unknown";
  return `${ip}:${email}`;
}

function checkLoginLimit(req, email) {
  const key = clientKey(req, email);
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || now > current.resetAt) {
    loginAttempts.set(key, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return { ok: true, key };
  }
  return { ok: current.count < MAX_LOGIN_ATTEMPTS, key, resetAt: current.resetAt };
}

function recordLoginFailure(key) {
  const current = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + LOGIN_WINDOW_MS };
  current.count += 1;
  loginAttempts.set(key, current);
}

function clearLoginFailures(key) {
  loginAttempts.delete(key);
}

function verifyAdmin(email, password) {
  const account = adminAccounts.find((item) => item.email === email);
  if (!account) return false;
  const candidateHash = scryptSync(String(password || ""), account.salt, 64);
  const expectedHash = Buffer.from(account.hash, "hex");
  return expectedHash.length === candidateHash.length && timingSafeEqual(candidateHash, expectedHash);
}

function sameOrigin(req) {
  if (!["POST", "PUT", "DELETE", "PATCH"].includes(req.method || "")) return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function sessionCookie(req, sid, maxAge = 28800) {
  const secure = req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted ? "; Secure" : "";
  return `yf_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

async function handleApi(req, res, pathname) {
  if (!sameOrigin(req)) return json(res, 403, { error: "Origen no permitido" }, securityHeaders(req));
  const db = await readDb();

  if (req.method === "POST" && pathname === "/api/login") {
    const body = await parseBody(req);
    const email = sanitizeText(body.email).toLowerCase();
    const limit = checkLoginLimit(req, email);
    if (!limit.ok) return json(res, 429, { error: "Demasiados intentos. Espera unos minutos." }, securityHeaders(req));
    const ok = verifyAdmin(email, body.password);
    if (!ok) {
      recordLoginFailure(limit.key);
      return json(res, 401, { error: "Credenciales incorrectas" }, securityHeaders(req));
    }
    clearLoginFailures(limit.key);
    const sid = randomBytes(32).toString("hex");
    sessions.set(sid, { email, expiresAt: Date.now() + SESSION_TTL_MS });
    return json(res, 200, { ok: true }, securityHeaders(req, { "set-cookie": sessionCookie(req, sid) }));
  }

  if (req.method === "POST" && pathname === "/api/logout") {
    const sid = cookies(req).yf_session;
    if (sid) sessions.delete(sid);
    return json(res, 200, { ok: true }, securityHeaders(req, { "set-cookie": sessionCookie(req, "", 0) }));
  }

  if (req.method === "GET" && pathname === "/api/session") {
    return json(res, 200, { authenticated: isAuthed(req) }, securityHeaders(req));
  }

  if (req.method === "GET" && pathname === "/api/public") {
    return json(res, 200, {
      profile: db.profile,
      videos: db.videos,
      photos: db.photos,
      songs: db.songs
    }, securityHeaders(req));
  }

  if (req.method === "POST" && pathname === "/api/visit") {
    db.stats.visits += 1;
    await writeDb(db);
    return json(res, 200, { ok: true }, securityHeaders(req));
  }

  if (req.method === "POST" && pathname === "/api/click") {
    const body = await parseBody(req);
    const label = sanitizeText(body.label, 120) || "Click";
    const type = sanitizeText(body.type, 20);
    if (type === "youtube") db.stats.youtubeClicks += 1;
    else db.stats.spotifyClicks += 1;
    db.stats.clicks[label] = (db.stats.clicks[label] || 0) + 1;
    await writeDb(db);
    return json(res, 200, { ok: true }, securityHeaders(req));
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
    if (!item.name || !item.email || !item.message) return json(res, 400, { error: "Faltan campos requeridos" }, securityHeaders(req));
    db.contacts.unshift(item);
    await writeDb(db);
    return json(res, 201, { ok: true, contact: item }, securityHeaders(req));
  }

  if (pathname.startsWith("/api/admin/") && !requireAuth(req, res)) return;

  if (req.method === "GET" && pathname === "/api/admin/state") return json(res, 200, db, securityHeaders(req));

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
    return json(res, 200, { ok: true, profile: db.profile }, securityHeaders(req));
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
      return json(res, 201, { ok: true, item }, securityHeaders(req));
    }
    if (req.method === "DELETE") {
      const body = await parseBody(req);
      db[key] = db[key].filter((item) => item.id !== body.id);
      await writeDb(db);
      return json(res, 200, { ok: true }, securityHeaders(req));
    }
  }

  if (req.method === "DELETE" && pathname === "/api/admin/contacts") {
    const body = await parseBody(req);
    db.contacts = body.id ? db.contacts.filter((item) => item.id !== body.id) : [];
    await writeDb(db);
    return json(res, 200, { ok: true }, securityHeaders(req));
  }

  if (req.method === "POST" && pathname === "/api/admin/reset-stats") {
    db.stats = structuredClone(defaultDb.stats);
    await writeDb(db);
    return json(res, 200, { ok: true, stats: db.stats }, securityHeaders(req));
  }

  json(res, 404, { error: "Endpoint no encontrado" }, securityHeaders(req));
}

async function serveStatic(req, res, pathname) {
  if (!["GET", "HEAD"].includes(req.method || "")) return text(res, 405, "Metodo no permitido");
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
    const headers = type.startsWith("text/html")
      ? htmlSecurityHeaders(req, { "content-type": type, "cache-control": "no-store" })
      : securityHeaders(req, { "content-type": type, "cache-control": "public, max-age=3600" });
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
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
