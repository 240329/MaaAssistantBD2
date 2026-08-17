const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createServer } = require("../server");

function requestJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: pathname }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolve({ statusCode: response.statusCode, body: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
  });
}

function requestStatus(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: pathname }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    }).on("error", reject);
  });
}

async function startServer() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

test("serves the UI entry point", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const port = server.address().port;
  const result = await new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: "/" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ statusCode: response.statusCode, body }));
    }).on("error", reject);
  });
  assert.equal(result.statusCode, 200);
  assert.match(result.body, /棕色尘埃2助手/);
});

test("enumerates visible top-level Windows through the backend API", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const result = await requestJson(server.address().port, "/api/windows");
  assert.equal(result.statusCode, 200);
  assert.ok(Array.isArray(result.body.windows));
  for (const window of result.body.windows) {
    assert.equal(typeof window.hwnd, "string");
    assert.equal(typeof window.title, "string");
    assert.equal(typeof window.processName, "string");
    assert.equal(typeof window.rect.left, "number");
  }
});

test("rejects traversal outside the web root", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const result = await new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: server.address().port, path: "/../server.js" }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    }).on("error", reject);
  });
  assert.equal(result, 403);
});

test("rejects invalid window handles before invoking capture", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const statusCode = await requestStatus(server.address().port, "/api/windows/not-a-handle/capture");
  assert.equal(statusCode, 404);
});

test("returns a controlled capture error for a missing window", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const result = await requestJson(server.address().port, "/api/windows/0/capture");
  assert.equal(result.statusCode, 422);
  assert.match(result.body.error, /无法捕获目标窗口/);
});

test("returns coordinate mapping diagnostics without invoking input", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const result = await requestJson(server.address().port, "/api/coordinates/map?clientWidth=1600&clientHeight=1200");
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.logicalWidth, 1920);
  assert.equal(result.body.offsetX, 0);
  assert.equal(result.body.offsetY, 150);
});

test("rejects invalid coordinate mapping dimensions", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const result = await requestJson(server.address().port, "/api/coordinates/map?clientWidth=0&clientHeight=720");
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /坐标映射参数无效/);
});
