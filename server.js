const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const now = new Date().toISOString();
    const seed = {
      settings: {
        childName: "Nitzan",
        parentPin: "1234",
        autoplay: true,
        colorTheme: "sunny"
      },
      videos: [
        {
          id: crypto.randomUUID(),
          title: "Sesame Street: Elmo Songs",
          youtubeId: "v1zL106SGZ8",
          category: "Songs",
          enabled: true,
          createdAt: now
        },
        {
          id: crypto.randomUUID(),
          title: "Super Simple Songs: Twinkle Twinkle",
          youtubeId: "yCjJyiqpAuU",
          category: "Songs",
          enabled: true,
          createdAt: now
        },
        {
          id: crypto.randomUUID(),
          title: "Numberblocks: Learn Numbers",
          youtubeId: "0VLxWIHRD4E",
          category: "Learning",
          enabled: true,
          createdAt: now
        }
      ]
    };
    writeDb(seed);
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2) + "\n");
}

function send(res, status, body, type) {
  const isBuffer = Buffer.isBuffer(body);
  const payload = isBuffer || typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": type || "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function extractYoutubeId(input) {
  const value = String(input || "").trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value;
  const patterns = [
    /youtube\.com\/watch\?[^#]*v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1];
  }
  return "";
}

function cleanMediaUrl(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^\/videos\/[a-zA-Z0-9._% -]+\.(mp4|m4v|mov)$/i.test(value)) return value;
  return "";
}

function cleanVideo(input, existing) {
  const requestedType = String(input.sourceType || "").toLowerCase();
  const rawUrl = input.videoUrl || input.youtubeId || input.url;
  const mp4Url = cleanMediaUrl(rawUrl);
  const sourceType = requestedType === "mp4" || mp4Url ? "mp4" : "youtube";
  const youtubeId = sourceType === "youtube" ? extractYoutubeId(rawUrl) : "";
  const videoUrl = sourceType === "mp4" ? mp4Url : "";
  const title = String(input.title || "").trim();
  if (!title) throw new Error("Title is required");
  if (sourceType === "youtube" && !youtubeId) throw new Error("YouTube video ID or URL is required");
  if (sourceType === "mp4" && !videoUrl) throw new Error("MP4 URL must be http(s) or /videos/file.mp4");

  return {
    id: existing && existing.id ? existing.id : crypto.randomUUID(),
    title,
    sourceType,
    youtubeId,
    videoUrl,
    thumbnailUrl: String(input.thumbnailUrl || "").trim(),
    category: String(input.category || "Favorites").trim() || "Favorites",
    enabled: input.enabled !== false,
    createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString()
  };
}

function getVideoById(id) {
  const db = readDb();
  return db.videos.find(video => video.id === id && video.enabled !== false);
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = String(rangeHeader).match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function resolveLocalVideo(videoUrl) {
  if (!videoUrl || !videoUrl.startsWith("/videos/")) return "";
  const relative = decodeURIComponent(videoUrl.replace(/^\//, ""));
  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(path.join(PUBLIC_DIR, "videos"))) return "";
  return filePath;
}

function streamLocalMp4(req, res, video) {
  const filePath = resolveLocalVideo(video.videoUrl);
  if (!filePath) return send(res, 400, { error: "Invalid local video path" });
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, { error: "Video file not found" });
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || "video/mp4";
    const range = parseRange(req.headers.range, stat.size);
    if (!range) {
      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store"
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    res.writeHead(206, {
      "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": range.end - range.start + 1,
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    fs.createReadStream(filePath, range).pipe(res);
  });
}

function proxyRemoteMp4(req, res, video) {
  let url;
  try {
    url = new URL(video.videoUrl);
  } catch (err) {
    return send(res, 400, { error: "Invalid remote video URL" });
  }
  const client = url.protocol === "https:" ? https : http;
  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;
  const upstream = client.request(url, { method: "GET", headers }, upstreamRes => {
    const responseHeaders = {
      "Content-Type": upstreamRes.headers["content-type"] || "video/mp4",
      "Accept-Ranges": upstreamRes.headers["accept-ranges"] || "bytes",
      "Cache-Control": "no-store"
    };
    if (upstreamRes.headers["content-length"]) responseHeaders["Content-Length"] = upstreamRes.headers["content-length"];
    if (upstreamRes.headers["content-range"]) responseHeaders["Content-Range"] = upstreamRes.headers["content-range"];
    res.writeHead(upstreamRes.statusCode || 200, responseHeaders);
    upstreamRes.pipe(res);
  });
  upstream.on("error", err => send(res, 502, { error: err.message || "Could not stream remote video" }));
  upstream.end();
}

function handleStream(req, res, pathname) {
  const match = pathname.match(/^\/api\/stream\/([^/]+)$/);
  if (!match || req.method !== "GET") return false;
  const video = getVideoById(decodeURIComponent(match[1]));
  if (!video) {
    send(res, 404, { error: "Video not found" });
    return true;
  }
  if (video.sourceType !== "mp4") {
    send(res, 400, { error: "This video is not an MP4 source" });
    return true;
  }
  if (/^https?:\/\//i.test(video.videoUrl)) proxyRemoteMp4(req, res, video);
  else streamLocalMp4(req, res, video);
  return true;
}

async function handleApi(req, res, pathname) {
  try {
    const db = readDb();

    if (req.method === "GET" && pathname === "/api/videos") {
      return send(res, 200, {
        settings: db.settings,
        videos: db.videos
      });
    }

    if (req.method === "POST" && pathname === "/api/videos") {
      const body = await readBody(req);
      const video = cleanVideo(body);
      db.videos.unshift(video);
      writeDb(db);
      return send(res, 201, video);
    }

    const videoMatch = pathname.match(/^\/api\/videos\/([^/]+)$/);
    if (videoMatch && req.method === "PUT") {
      const id = decodeURIComponent(videoMatch[1]);
      const index = db.videos.findIndex(video => video.id === id);
      if (index === -1) return send(res, 404, { error: "Video not found" });
      const body = await readBody(req);
      db.videos[index] = cleanVideo(body, db.videos[index]);
      writeDb(db);
      return send(res, 200, db.videos[index]);
    }

    if (videoMatch && req.method === "DELETE") {
      const id = decodeURIComponent(videoMatch[1]);
      const before = db.videos.length;
      db.videos = db.videos.filter(video => video.id !== id);
      if (db.videos.length === before) return send(res, 404, { error: "Video not found" });
      writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (req.method === "PUT" && pathname === "/api/settings") {
      const body = await readBody(req);
      db.settings = {
        childName: String(body.childName || db.settings.childName || "Nitzan").trim() || "Nitzan",
        parentPin: String(body.parentPin || db.settings.parentPin || "1234").trim() || "1234",
        autoplay: body.autoplay === true,
        colorTheme: String(body.colorTheme || db.settings.colorTheme || "sunny")
      };
      writeDb(db);
      return send(res, 200, db.settings);
    }

    return send(res, 404, { error: "API route not found" });
  } catch (err) {
    return send(res, 400, { error: err.message || "Bad request" });
  }
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      const fallback = path.join(PUBLIC_DIR, "index.html");
      fs.readFile(fallback, (readErr, data) => {
        if (readErr) return send(res, 404, "Not found", "text/plain; charset=utf-8");
        send(res, 200, data, MIME[".html"]);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    if (req.headers.range && (ext === ".mp4" || ext === ".m4v" || ext === ".mov")) {
      const range = req.headers.range;
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start >= stat.size || end >= stat.size) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": MIME[ext] || "application/octet-stream"
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) return send(res, 500, "Server error", "text/plain; charset=utf-8");
      send(res, 200, data, MIME[ext] || "application/octet-stream");
    });
  });
}

ensureDb();

http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(parsed.pathname);
  if (handleStream(req, res, pathname)) return;
  if (pathname.startsWith("/api/")) {
    handleApi(req, res, pathname);
  } else {
    serveStatic(req, res, pathname);
  }
}).listen(PORT, HOST, () => {
  console.log(`Nitzan Kids Video is running at http://localhost:${PORT}`);
  console.log(`LAN access: http://YOUR-COMPUTER-IP:${PORT}`);
  console.log(`Parent panel: http://localhost:${PORT}/parent.html`);
});
