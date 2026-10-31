const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer, HOST } = require("../src/server");

// 一時ディレクトリに web/ と、その外に置いた秘密のファイルを用意する
function setup() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "apptime-srv-"));
  const webDir = path.join(parent, "web");
  fs.mkdirSync(webDir);
  fs.writeFileSync(
    path.join(webDir, "index.html"),
    "<!doctype html><title>ok</title>",
  );
  fs.writeFileSync(path.join(parent, "secret.txt"), "SECRET");
  return { parent, webDir };
}

async function start(webDir) {
  const status = {
    date: "2026-10-31",
    counting: false,
    target: null,
    idleSeconds: 30,
    totals: {
      clipstudio: { label: "クリスタ", seconds: 0 },
      slaythespire: { label: "スレスパ", seconds: 0 },
    },
    updatedAt: "12:00:00",
  };
  const server = createServer({ getStatus: () => status, webDir });
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  const { port } = server.address();
  return {
    base: `http://${HOST}:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

test("health は ok と version を JSON で返す", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const res = await fetch(`${s.base}/api/health`);
    assert.equal(res.status, 200);
    assert.match(
      res.headers.get("content-type"),
      /^application\/json; charset=utf-8/,
    );
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.version, "string");
  } finally {
    await s.close();
  }
});

test("status は getStatus の結果をそのまま返す", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const body = await (await fetch(`${s.base}/api/status`)).json();
    assert.equal(body.date, "2026-10-31");
    assert.equal(body.totals.clipstudio.label, "クリスタ");
  } finally {
    await s.close();
  }
});

test("/ は web/index.html を返す", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const res = await fetch(`${s.base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /^text\/html/);
    assert.match(await res.text(), /<title>ok<\/title>/);
  } finally {
    await s.close();
  }
});

test("web の外のファイルは、エンコードした ../ でも読めない", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    for (const p of [
      "/..%2Fsecret.txt",
      "/..%5Csecret.txt",
      "/%2e%2e/secret.txt",
      "/..%2F..%2Fpackage.json",
    ]) {
      const res = await fetch(`${s.base}${p}`);
      const text = await res.text();
      assert.equal(res.status, 404, p);
      assert.ok(!text.includes("SECRET"), p);
    }
  } finally {
    await s.close();
  }
});

test("壊れたパーセントエンコードは 404 になる（例外で落ちない）", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const res = await fetch(`${s.base}/%E0%A4%A`);
    assert.equal(res.status, 404);
  } finally {
    await s.close();
  }
});

test("存在しないパスと未知の API は 404 の JSON", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const a = await fetch(`${s.base}/nothing.html`);
    assert.equal(a.status, 404);
    assert.equal((await a.json()).error, "not_found");
    const b = await fetch(`${s.base}/api/unknown`);
    assert.equal(b.status, 404);
  } finally {
    await s.close();
  }
});

test("POST など GET 以外は 405", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const res = await fetch(`${s.base}/api/status`, { method: "POST" });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET, HEAD");
  } finally {
    await s.close();
  }
});
