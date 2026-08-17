const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeController } = require("../src/core/fake-controller");
const { VisionService } = require("../src/core/vision-service");
const { PipelineEngine } = require("../src/core/pipeline-engine");

test("pipeline completes a registered detector flow without real input", async () => {
  const controller = new FakeController({ width: 1920, height: 1080 });
  const vision = new VisionService();
  vision.register("always", async () => ({ matched: true }));
  const engine = new PipelineEngine({ controller, vision });
  const result = await engine.run({ id: "fixture", start: "begin", nodes: { begin: { detect: { type: "always" }, next: null } } });
  assert.equal(result.state, "completed");
  assert.equal(controller.calls[0].type, "screenshot");
});

test("pipeline reports TODO for an unregistered detector", async () => {
  const engine = new PipelineEngine({ controller: new FakeController(), vision: new VisionService() });
  const result = await engine.run({ id: "fixture", start: "begin", nodes: { begin: { detect: { type: "template", resource: "TODO" } } } });
  assert.equal(result.state, "todo");
  assert.match(result.reason, /未注册识别器 template/);
});

test("pipeline blocks fake controller actions instead of sending input", async () => {
  const controller = new FakeController();
  const vision = new VisionService();
  vision.register("always", async () => ({ matched: true }));
  const engine = new PipelineEngine({ controller, vision });
  const result = await engine.run({ id: "fixture", start: "begin", nodes: { begin: { detect: { type: "always" }, action: { type: "click", x: 10, y: 20 } } } });
  assert.equal(result.state, "blocked");
  assert.equal(controller.calls.at(-1).type, "click");
});

test("pipeline stops cyclic resources at the transition limit", async () => {
  const controller = new FakeController();
  const vision = new VisionService();
  vision.register("always", async () => ({ matched: true }));
  const engine = new PipelineEngine({ controller, vision, maxTransitions: 3 });
  const result = await engine.run({ id: "cycle", start: "loop", nodes: { loop: { detect: { type: "always" }, next: "loop" } } });
  assert.equal(result.state, "failed");
  assert.match(result.reason, /最大转换次数/);
});
