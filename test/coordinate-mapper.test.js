const test = require("node:test");
const assert = require("node:assert/strict");
const { CoordinateMapper } = require("../src/core/coordinate-mapper");
const { FakeController } = require("../src/core/fake-controller");

test("maps a 16:9 logical canvas to an exact client area", () => {
  const mapper = new CoordinateMapper(1920, 1080);
  const result = mapper.logicalToClient({ x: 960, y: 540 }, 1920, 1080);
  assert.deepEqual(result, { x: 960, y: 540, inCanvas: true });
});

test("preserves aspect ratio and reports horizontal letterboxing", () => {
  const mapper = new CoordinateMapper(1920, 1080);
  const transform = mapper.getTransform(1600, 1200);
  assert.equal(transform.scale, 1600 / 1920);
  assert.equal(transform.offsetX, 0);
  assert.equal(transform.offsetY, 150);
  assert.deepEqual(mapper.logicalToClient({ x: 0, y: 0 }, 1600, 1200), { x: 0, y: 150, inCanvas: true });
  assert.equal(mapper.clientToLogical({ x: 800, y: 20 }, 1600, 1200).inCanvas, false);
});

test("round trips logical coordinates within floating point tolerance", () => {
  const mapper = new CoordinateMapper(1280, 720);
  const client = mapper.logicalToClient({ x: 314, y: 271 }, 1500, 1000);
  const logical = mapper.clientToLogical(client, 1500, 1000);
  assert.ok(Math.abs(logical.x - 314) < 0.000001);
  assert.ok(Math.abs(logical.y - 271) < 0.000001);
});

test("fake controller records diagnostics without sending input", () => {
  const controller = new FakeController({ width: 1280, height: 720 });
  assert.deepEqual(controller.screenshot(), { kind: "fake-screenshot", width: 1280, height: 720 });
  assert.deepEqual(controller.click({ x: 10, y: 20 }), { accepted: false, reason: "fake-controller" });
  assert.deepEqual(controller.calls.map((call) => call.type), ["screenshot", "click"]);
});
