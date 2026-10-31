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
  fs.createReadStream(file).pipe(res);
}

// getStatus(): /api/status の本文を返す関数。webDir: 静的配信の root。
function createRequestHandler({ getStatus, webDir }) {
  return function handle(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return sendJson(res, 405, { error: "method_not_allowed" });
    }

    const { pathname } = new URL(req.url, "http://127.0.0.1");

    if (pathname === "/api/health") {
      return sendJson(res, 200, { ok: true, version: VERSION });
    }
    if (pathname === "/api/status") {
      return sendJson(res, 200, getStatus());
    }
    if (pathname.startsWith("/api/")) {
      return sendJson(res, 404, { error: "not_found" });
    }
    return serveStatic(req, res, webDir, pathname);
  };
}

module.exports = { createRequestHandler, VERSION };
