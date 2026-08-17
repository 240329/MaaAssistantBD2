const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { taskDefinitions, createDefaultPlan } = require("../src/tasks/task-definitions");
const { loadTaskResource } = require("../src/tasks/resource-loader");
const { TaskScheduler } = require("../src/tasks/task-scheduler");
const { PlanStore } = require("../src/tasks/plan-store");

test("registers every planned feature with a stable TODO resource contract", () => {
  assert.equal(taskDefinitions.length, 23);
  assert.equal(new Set(taskDefinitions.map((item) => item.id)).size, taskDefinitions.length);
  for (const definition of taskDefinitions) {
    assert.equal(definition.status, "todo");
    assert.match(definition.resource, /^resources\/tasks\/.+\.json$/);
    assert.match(definition.logic, /^TODO:/);
  }
});

test("returns a controlled TODO placeholder for missing task resources", () => {
  const definition = taskDefinitions[0];
  const result = loadTaskResource(definition, path.join(os.tmpdir(), "bd2-missing-root"));
  assert.equal(result.available, false);
  assert.equal(result.data.status, "todo");
  assert.equal(result.data.error, "resource-not-created");
});

test("plan store creates and atomically persists the default plan", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bd2-plan-"));
  const filePath = path.join(root, "nested", "task-plan.json");
  const store = new PlanStore(filePath);
  const plan = store.load();
  assert.ok(plan.tasks.length > 0);
  plan.tasks[0].enabled = false;
  store.save(plan);
  assert.equal(new PlanStore(filePath).load().tasks[0].enabled, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("scheduler safely skips TODO resources and emits lifecycle events", async () => {
  const events = [];
  const scheduler = new TaskScheduler({ resourceRoot: path.join(os.tmpdir(), "bd2-resources-missing") });
  scheduler.on("event", (event) => events.push(event));
  scheduler.loadPlan(createDefaultPlan());
  const result = await scheduler.run({ delayMs: 0 });
  assert.equal(result.state, "idle");
  assert.ok(result.results.every((item) => item.state === "skipped"));
  assert.ok(events.some((event) => event.type === "run.started"));
  assert.ok(events.some((event) => event.type === "task.resource"));
  assert.equal(events.at(-1).type, "run.completed");
});

test("scheduler retries failures and reports a terminal failure", async () => {
  let calls = 0;
  const scheduler = new TaskScheduler({
    resourceRoot: __dirname,
    executor: async () => { calls += 1; throw new Error("fixture failure"); }
  });
  const plan = createDefaultPlan();
  plan.tasks = [{ ...plan.tasks[0], retryLimit: 2 }];
  scheduler.loadPlan(plan);
  const result = await scheduler.run({ delayMs: 0 });
  assert.equal(calls, 3);
  assert.equal(result.results[0].state, "failed");
  assert.equal(result.results[0].attempts, 3);
});

test("scheduler cancellation stops the remaining queue", async () => {
  const scheduler = new TaskScheduler({
    resourceRoot: __dirname,
    executor: async () => ({ state: "completed", message: "fixture" })
  });
  scheduler.loadPlan(createDefaultPlan());
  scheduler.on("event", (event) => {
    if (event.type === "task.completed") scheduler.requestCancel();
  });
  const result = await scheduler.run({ delayMs: 0 });
  assert.equal(result.state, "cancelled");
  assert.equal(result.results.length, 1);
});
