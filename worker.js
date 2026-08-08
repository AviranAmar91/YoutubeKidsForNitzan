const DB_KEY = "db";

const seedDb = {
  settings: {
    childName: "Nitzan",
    parentPin: "6363",
    autoplay: true,
    colorTheme: "sunny"
  },
  videos: [
    {
      id: "seed-elmo",
      title: "Sesame Street: Elmo Songs",
      sourceType: "youtube",
      youtubeId: "v1zL106SGZ8",
      videoUrl: "",
      thumbnailUrl: "",
      category: "Songs",
      enabled: true,
      createdAt: "2026-08-08T00:00:00.000Z"
    },
    {
      id: "seed-twinkle",
      title: "Super Simple Songs: Twinkle Twinkle",
      sourceType: "youtube",
      youtubeId: "yCjJyiqpAuU",
      videoUrl: "",
      thumbnailUrl: "",
      category: "Songs",
      enabled: true,
      createdAt: "2026-08-08T00:00:00.000Z"
    },
    {
      id: "seed-numberblocks",
      title: "Numberblocks: Learn Numbers",
      sourceType: "youtube",
      youtubeId: "0VLxWIHRD4E",
      videoUrl: "",
      thumbnailUrl: "",
      category: "Learning",
      enabled: true,
      createdAt: "2026-08-08T00:00:00.000Z"
    }
  ]
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
}

async function readDb(env) {
  if (!env.VIDEO_DB || env.VIDEO_DB.get === undefined) return seedDb;
  const stored = await env.VIDEO_DB.get(DB_KEY, "json");
  if (stored) return stored;
  await env.VIDEO_DB.put(DB_KEY, JSON.stringify(seedDb));
  return seedDb;
}

async function writeDb(env, db) {
  if (!env.VIDEO_DB || env.VIDEO_DB.put === undefined) {
    throw new Error("Cloudflare KV binding VIDEO_DB is not configured");
  }
  await env.VIDEO_DB.put(DB_KEY, JSON.stringify(db));
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
  for (let i = 0; i < patterns.length; i += 1) {
    const match = value.match(patterns[i]);
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
    id: existing && existing.id ? existing.id : randomId(),
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

async function bodyJson(request) {
  try {
    return await request.json();
  } catch (err) {
    return {};
  }
}

async function handleApi(request, env, pathname) {
  const db = await readDb(env);

  if (request.method === "GET" && pathname === "/api/videos") {
    return json({ settings: db.settings, videos: db.videos });
  }

  if (request.method === "POST" && pathname === "/api/videos") {
    const video = cleanVideo(await bodyJson(request));
    db.videos.unshift(video);
    await writeDb(env, db);
    return json(video, 201);
  }

  const videoMatch = pathname.match(/^\/api\/videos\/([^/]+)$/);
  if (videoMatch && request.method === "PUT") {
    const id = decodeURIComponent(videoMatch[1]);
    const index = db.videos.findIndex(video => video.id === id);
    if (index === -1) return json({ error: "Video not found" }, 404);
    db.videos[index] = cleanVideo(await bodyJson(request), db.videos[index]);
    await writeDb(env, db);
    return json(db.videos[index]);
  }

  if (videoMatch && request.method === "DELETE") {
    const id = decodeURIComponent(videoMatch[1]);
    const before = db.videos.length;
    db.videos = db.videos.filter(video => video.id !== id);
    if (db.videos.length === before) return json({ error: "Video not found" }, 404);
    await writeDb(env, db);
    return json({ ok: true });
  }

  if (request.method === "PUT" && pathname === "/api/settings") {
    const body = await bodyJson(request);
    db.settings = {
      childName: String(body.childName || db.settings.childName || "Nitzan").trim() || "Nitzan",
      parentPin: String(body.parentPin || db.settings.parentPin || "1234").trim() || "1234",
      autoplay: body.autoplay === true,
      colorTheme: String(body.colorTheme || db.settings.colorTheme || "sunny")
    };
    await writeDb(env, db);
    return json(db.settings);
  }

  if (pathname.startsWith("/api/stream/")) {
    return json({ error: "Cloudflare deployment supports direct remote MP4 URLs, not local filesystem streaming" }, 501);
  }

  return json({ error: "API route not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, url.pathname);
      }
      if (env.ASSETS && env.ASSETS.fetch) {
        return env.ASSETS.fetch(request);
      }
      return new Response("Static assets binding is not configured", { status: 500 });
    } catch (err) {
      return json({ error: err.message || "Server error" }, 500);
    }
  }
};
