// HTTP サーバの組み立て。待ち受けは 127.0.0.1 のみ（外部には公開しない）。
const http = require("node:http");
const { createRequestHandler } = require("./routes");

const HOST = "127.0.0.1";
const DEFAULT_PORT = 17600;

function createServer({ getStatus, webDir }) {
  return http.createServer(createRequestHandler({ getStatus, webDir }));
}

module.exports = { createServer, HOST, DEFAULT_PORT };
