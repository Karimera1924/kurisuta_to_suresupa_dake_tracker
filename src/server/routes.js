// リクエストの振り分け。API は JSON、それ以外は web/ 配下の静的ファイル。
const fs = require("node:fs");
const path = require("node:path");

const VERSION = "0.1.0";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

// URL パスを web/ 配下の実ファイルに変換する。web/ の外に出るものは null を返す。
function resolveStatic(webDir, pathname) {
  let rel;
  try {
    rel =
      pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  } catch {
    return null;
  }
  const root = path.resolve(webDir);
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return null;
  return file;
}

function serveStatic(req, res, webDir, pathname) {
  const file = resolveStatic(webDir, pathname);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return sendJson(res, 404, { error: "not_found" });
  }
  const type =
    CONTENT_TYPES[path.extname(file).toLowerCase()] ??
    "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  if (req.method === "HEAD") return res.end();
  const stream = fs.createReadStream(file);
  // 読み込み途中のエラー（ファイルのロックなど）でプロセスを落とさない
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

const SETTINGS_BODY_LIMIT = 4 * 1024;

// 設定の書き換えはブラウザから届きうる（別サイトのページからの CSRF）ので、
// JSON 以外の Content-Type と、localhost 以外の Host は拒否する。
function isLocalHost(hostHeader) {
  const host = String(hostHeader || "").replace(/:\d+$/, "");
  return host === "127.0.0.1" || host === "localhost";
}

function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("too_large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("bad_json"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

// 設定を書き換える POST の共通処理。apply(body) が検証と保存をして、返す値を 200 の本文にする。
function handleJsonPost(req, res, apply) {
  const type = String(req.headers["content-type"] || "");
  if (!type.toLowerCase().startsWith("application/json")) {
    return sendJson(res, 415, { error: "unsupported_media_type" });
  }
  if (!isLocalHost(req.headers.host)) {
    return sendJson(res, 403, { error: "forbidden" });
  }
  readJsonBody(req, SETTINGS_BODY_LIMIT)
    .then((body) => {
      try {
        sendJson(res, 200, apply(body));
      } catch (err) {
        sendJson(res, 400, { error: "invalid", message: err.message });
      }
    })
    .catch((err) => {
      if (res.headersSent) return;
      sendJson(res, err.status || 400, { error: err.message });
    });
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function route(
  req,
  res,
  { getStatus, getHistory, getSessions, setPinned, setAliases, webDir },
) {
  let pathname;
  let searchParams;
  try {
    ({ pathname, searchParams } = new URL(req.url, "http://127.0.0.1"));
  } catch {
    return sendJson(res, 400, { error: "bad_request" });
  }

  if (pathname === "/api/settings" && req.method === "POST") {
    return handleJsonPost(req, res, (body) => ({
      pinned: setPinned(body && body.pinned),
    }));
  }
  if (pathname === "/api/aliases" && req.method === "POST") {
    return handleJsonPost(req, res, (body) => ({
      aliases: setAliases(body && body.aliases),
    }));
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return sendJson(res, 405, { error: "method_not_allowed" });
  }

  if (pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, version: VERSION });
  }
  if (pathname === "/api/status") {
    return sendJson(res, 200, getStatus());
  }
  if (pathname === "/api/history") {
    const raw = Number(searchParams.get("days") || 7);
    const days = Number.isFinite(raw)
      ? Math.min(Math.max(Math.trunc(raw), 1), 90)
      : 7;
    return sendJson(res, 200, getHistory(days));
  }
  if (pathname === "/api/sessions") {
    const date = searchParams.get("date") || undefined;
    if (date !== undefined && !DATE_PATTERN.test(date)) {
      return sendJson(res, 400, {
        error: "invalid",
        message: "date は YYYY-MM-DD",
      });
    }
    return sendJson(res, 200, getSessions(date));
  }
  if (pathname.startsWith("/api/")) {
    return sendJson(res, 404, { error: "not_found" });
  }
  return serveStatic(req, res, webDir, pathname);
}

// getStatus(): /api/status の本文を返す関数。getHistory(days) / getSessions(date) / setPinned(names) / setAliases(map) も同様。
// webDir: 静的配信の root。1 リクエストの例外で計測プロセスを止めないよう、ここで 500 に変える。
function createRequestHandler({
  getStatus,
  getHistory,
  getSessions,
  setPinned,
  setAliases,
  webDir,
}) {
  return function handle(req, res) {
    try {
      route(req, res, {
        getStatus,
        getHistory,
        getSessions,
        setPinned,
        setAliases,
        webDir,
      });
    } catch {
      if (!res.headersSent) sendJson(res, 500, { error: "internal" });
      else res.destroy();
    }
  };
}

module.exports = { createRequestHandler, VERSION };
