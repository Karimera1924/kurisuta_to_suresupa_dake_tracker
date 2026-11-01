const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
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

async function start(webDir, overrides = {}) {
  const status = {
    date: "2026-10-31",
    counting: false,
    target: null,
    idleSeconds: 30,
    pinned: [
      {
        key: "clipstudiopaint",
        label: "ClipStudioPaint",
        seconds: 0,
        counting: false,
      },
    ],
    totals: {
      clipstudiopaint: { label: "ClipStudioPaint", seconds: 0 },
    },
    updatedAt: "12:00:00",
  };
  const calls = {
    setPinned: [],
    setAliases: [],
    history: [],
    sessions: [],
    titles: [],
  };
  const server = createServer({
    getStatus: () => status,
    getHistory: (days) => {
      calls.history.push(days);
      return { days: [] };
    },
    getSessions: (date) => {
      calls.sessions.push(date);
      return { date: date ?? "2026-10-31", sessions: [], hourly: [] };
    },
    getTitles: (date) => {
      calls.titles.push(date);
      return { date: date ?? "2026-10-31", titles: [] };
    },
    setPinned: (names) => {
      calls.setPinned.push(names);
      if (overrides.setPinned) return overrides.setPinned(names);
      return names;
    },
    setAliases: (map) => {
      calls.setAliases.push(map);
      if (overrides.setAliases) return overrides.setAliases(map);
      return map;
    },
    webDir,
  });
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  const { port } = server.address();
  return {
    base: `http://${HOST}:${port}`,
    port,
    calls,
    close: () => new Promise((r) => server.close(r)),
  };
}

// fetch は Host ヘッダを上書きできないため、テストでは http で直接送る
function rawRequest(port, { method, path: urlPath, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port, method, path: urlPath, headers },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, text }));
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const JSON_HEADERS = { "Content-Type": "application/json" };

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

test("status は getStatus の結果をそのまま返す（pinned を含む）", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const body = await (await fetch(`${s.base}/api/status`)).json();
    assert.equal(body.date, "2026-10-31");
    assert.equal(body.pinned[0].label, "ClipStudioPaint");
    assert.equal(body.totals.clipstudiopaint.label, "ClipStudioPaint");
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

test("POST /api/settings: JSON で localhost なら保存して 200", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const res = await rawRequest(s.port, {
      method: "POST",
      path: "/api/settings",
      headers: JSON_HEADERS,
      body: JSON.stringify({ pinned: ["Notepad"] }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text), { pinned: ["Notepad"] });
    assert.deepEqual(s.calls.setPinned, [["Notepad"]]);
  } finally {
    await s.close();
  }
});

test("POST /api/settings: JSON 以外の Content-Type は 415", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const res = await rawRequest(s.port, {
      method: "POST",
      path: "/api/settings",
      headers: { "Content-Type": "text/plain" },
      body: '{"pinned":["Notepad"]}',
    });
    assert.equal(res.status, 415);
    assert.equal(s.calls.setPinned.length, 0);
  } finally {
    await s.close();
  }
});

test("POST /api/settings: localhost 以外の Host は 403", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const res = await rawRequest(s.port, {
      method: "POST",
      path: "/api/settings",
      headers: { ...JSON_HEADERS, Host: "evil.example" },
      body: JSON.stringify({ pinned: ["Notepad"] }),
    });
    assert.equal(res.status, 403);
    assert.equal(s.calls.setPinned.length, 0);
  } finally {
    await s.close();
  }
});

test("POST /api/settings: 壊れた JSON は 400", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const res = await rawRequest(s.port, {
      method: "POST",
      path: "/api/settings",
      headers: JSON_HEADERS,
      body: "{ broken",
    });
    assert.equal(res.status, 400);
  } finally {
    await s.close();
  }
});

test("POST /api/settings: setPinned が拒否したら 400 と message", async () => {
  const { webDir } = setup();
  const s = await start(webDir, {
    setPinned: () => {
      throw new Error("ピン留めは最大 2 件");
    },
  });
  try {
    const res = await rawRequest(s.port, {
      method: "POST",
      path: "/api/settings",
      headers: JSON_HEADERS,
      body: JSON.stringify({ pinned: ["a", "b", "c"] }),
    });
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.text).error, "invalid");
  } finally {
    await s.close();
  }
});

test("GET /api/history は days を 1〜90 に収めて渡す（既定 7）", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    await fetch(`${s.base}/api/history`);
    await fetch(`${s.base}/api/history?days=500`);
    await fetch(`${s.base}/api/history?days=0`);
    await fetch(`${s.base}/api/history?days=abc`);
    assert.deepEqual(s.calls.history, [7, 90, 1, 7]);
  } finally {
    await s.close();
  }
});

test("POST /api/aliases: JSON で localhost なら保存して 200", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const res = await rawRequest(s.port, {
      method: "POST",
      path: "/api/aliases",
      headers: JSON_HEADERS,
      body: JSON.stringify({ aliases: { clipstudiopaint: "クリス" } }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text), {
      aliases: { clipstudiopaint: "クリス" },
    });
    assert.deepEqual(s.calls.setAliases, [{ clipstudiopaint: "クリス" }]);
  } finally {
    await s.close();
  }
});

test("POST /api/aliases: JSON 以外の Content-Type は 415", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const res = await rawRequest(s.port, {
      method: "POST",
      path: "/api/aliases",
      headers: { "Content-Type": "text/plain" },
      body: '{"aliases":{"a":"b"}}',
    });
    assert.equal(res.status, 415);
    assert.equal(s.calls.setAliases.length, 0);
  } finally {
    await s.close();
  }
});

test("POST /api/aliases: localhost 以外の Host は 403", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const res = await rawRequest(s.port, {
      method: "POST",
      path: "/api/aliases",
      headers: { ...JSON_HEADERS, Host: "evil.example" },
      body: JSON.stringify({ aliases: { a: "b" } }),
    });
    assert.equal(res.status, 403);
    assert.equal(s.calls.setAliases.length, 0);
  } finally {
    await s.close();
  }
});

test("POST /api/aliases: setAliases が拒否したら 400 invalid と message", async () => {
  const { webDir } = setup();
  const s = await start(webDir, {
    setAliases: () => {
      throw new Error("別名は 8 文字まで");
    },
  });
  try {
    const res = await rawRequest(s.port, {
      method: "POST",
      path: "/api/aliases",
      headers: JSON_HEADERS,
      body: JSON.stringify({ aliases: { a: "123456789" } }),
    });
    assert.equal(res.status, 400);
    const body = JSON.parse(res.text);
    assert.equal(body.error, "invalid");
    assert.equal(body.message, "別名は 8 文字まで");
  } finally {
    await s.close();
  }
});

test("GET /api/sessions は date 省略時に今日扱い（undefined）で渡し、指定日はそのまま渡す", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const a = await (await fetch(`${s.base}/api/sessions`)).json();
    assert.equal(a.date, "2026-10-31");
    await fetch(`${s.base}/api/sessions?date=2026-10-30`);
    assert.deepEqual(s.calls.sessions, [undefined, "2026-10-30"]);
  } finally {
    await s.close();
  }
});

test("GET /api/sessions は日付の形式が違えば 400", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const res = await fetch(`${s.base}/api/sessions?date=2026/10/30`);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid");
    assert.equal(s.calls.sessions.length, 0);
  } finally {
    await s.close();
  }
});

test("GET /api/titles は date 省略時に undefined、指定日はそのまま渡す。形式違いは 400", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const a = await (await fetch(`${s.base}/api/titles`)).json();
    assert.equal(a.date, "2026-10-31");
    await fetch(`${s.base}/api/titles?date=2026-10-30`);
    const bad = await fetch(`${s.base}/api/titles?date=2026/10/30`);
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "invalid");
    assert.deepEqual(s.calls.titles, [undefined, "2026-10-30"]);
  } finally {
    await s.close();
  }
});

test("壊れた request-target でもサーバは落ちず、次のリクエストに答える", async () => {
  const { webDir } = setup();
  const s = await start(webDir);
  try {
    const net = require("node:net");
    await new Promise((resolve) => {
      const sock = net.connect(s.port, HOST, () => {
        sock.write("GET http://[ HTTP/1.1\r\nHost: x\r\n\r\n");
      });
      sock.on("data", () => sock.destroy());
      sock.on("error", () => resolve());
      sock.on("close", () => resolve());
    });
    const res = await fetch(`${s.base}/api/health`);
    assert.equal(res.status, 200);
  } finally {
    await s.close();
  }
});
