const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const { once } = require("node:events");
const { test } = require("node:test");

const script = path.resolve(
  __dirname,
  "../../packages/nocodb/docker/healthcheck.cjs"
);

async function check(port) {
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, PORT: String(port) },
    stdio: "pipe",
  });
  return (await once(child, "exit"))[0];
}

async function withServer(handler, run) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run(server.address().port);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

test("health check accepts a ready API and requests the readiness endpoint", async () => {
  await withServer(
    (request, response) => {
      assert.equal(request.url, "/api/v1/health");
      response.writeHead(200).end('{"ok":true}');
    },
    async (port) => assert.equal(await check(port), 0)
  );
});

test("health check rejects an API that is not ready", async () => {
  await withServer(
    (request, response) => {
      response.writeHead(503).end("Starting");
    },
    async (port) => assert.equal(await check(port), 1)
  );
});

test("health check rejects a connection failure", async () => {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await check(port), 1);
});

test("health check exits when the server stalls", async () => {
  await withServer(
    () => {},
    async (port) => {
      const start = Date.now();
      assert.equal(await check(port), 1);
      assert.ok(
        Date.now() - start < 5000,
        "must finish before the Docker timeout"
      );
    }
  );
});
