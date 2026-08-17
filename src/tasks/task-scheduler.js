const { EventEmitter } = require("events");
const { getTaskDefinition } = require("./task-definitions");
const { loadTaskResource } = require("./resource-loader");

const terminalStates = new Set(["completed", "skipped", "failed", "cancelled"]);

class TaskScheduler extends EventEmitter {
  constructor({ resourceRoot, clock = () => new Date(), executor } = {}) {
    super();
    this.resourceRoot = resourceRoot;
    this.clock = clock;
    this.plan = { version: 1, updatedAt: this.clock().toISOString(), tasks: [] };
    this.state = "idle";
    this.cancelRequested = false;
    this.activeTask = null;
    this.executor = executor || (async ({ definition, resource }) => {
      if (!resource.available) return { state: "skipped", message: "资源和具体逻辑尚未提供" };
      return { state: "completed", message: `${definition.name} 资源占位已加载，未执行游戏动作` };
    });
  }

  loadPlan(plan) {
    if (!plan || !Array.isArray(plan.tasks)) throw new Error("任务计划格式无效");
    this.plan = {
      version: plan.version || 1,
      updatedAt: plan.updatedAt || this.clock().toISOString(),
      tasks: plan.tasks.map((task) => this.normalizeTask(task))
    };
    this.emitEvent("plan.loaded", { taskCount: this.plan.tasks.length });
    return this.plan;
  }

  getPlan() {
    return JSON.parse(JSON.stringify(this.plan));
  }

  updatePlan(plan) {
    this.loadPlan(plan);
    this.plan.updatedAt = this.clock().toISOString();
    this.emitEvent("plan.updated", { taskCount: this.plan.tasks.length });
    return this.getPlan();
  }

  normalizeTask(task) {
    const definition = getTaskDefinition(task.definitionId);
    if (!definition) throw new Error(`未知任务定义：${task.definitionId}`);
    return {
      id: task.id || `${definition.id}-${Math.random().toString(36).slice(2, 8)}`,
      definitionId: definition.id,
      enabled: task.enabled !== false,
      parameters: task.parameters || {},
      retryLimit: Number.isInteger(task.retryLimit) && task.retryLimit >= 0 ? task.retryLimit : definition.retryLimit,
      state: "ready",
      attempts: 0,
      lastError: null
    };
  }

  requestCancel() {
    this.cancelRequested = true;
    if (this.state === "running") {
      this.state = "stopping";
      this.emitEvent("run.stopping", {});
    }
  }

  async run({ delayMs = 80 } = {}) {
    if (this.state === "running" || this.state === "stopping") throw new Error("任务计划正在运行");
    this.cancelRequested = false;
    this.state = "running";
    this.emitEvent("run.started", { taskCount: this.plan.tasks.length });
    const results = [];

    for (const task of this.plan.tasks) {
      const result = await this.runTask(task, delayMs);
      results.push(result);
      if (this.cancelRequested) break;
    }

    this.state = this.cancelRequested ? "cancelled" : "idle";
    this.emitEvent(this.cancelRequested ? "run.cancelled" : "run.completed", { results });
    return { state: this.state, results };
  }

  async runTask(task, delayMs) {
    const definition = getTaskDefinition(task.definitionId);
    if (!task.enabled) return this.finishTask(task, "skipped", "任务未启用");
    if (this.cancelRequested) return this.finishTask(task, "cancelled", "用户请求停止");

    const dependencyFailure = this.plan.tasks.find((candidate) => definition.dependencies.includes(candidate.definitionId) && candidate.state !== "completed");
    if (dependencyFailure) return this.finishTask(task, "skipped", `依赖任务未完成：${dependencyFailure.definitionId}`);

    this.activeTask = task;
    this.emitEvent("task.started", { task, definition });
    const resource = loadTaskResource(definition, this.resourceRoot);
    this.emitEvent("task.resource", { taskId: task.id, resource });

    for (let attempt = 0; attempt <= task.retryLimit; attempt += 1) {
      task.attempts = attempt + 1;
      if (this.cancelRequested) return this.finishTask(task, "cancelled", "用户请求停止");
      this.emitEvent("task.step", { taskId: task.id, step: "todo-placeholder", attempt: task.attempts, message: definition.logic });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        const result = await this.executor({ task, definition, resource, attempt: task.attempts });
        if (!terminalStates.has(result.state)) throw new Error(`执行器返回了无效状态：${result.state}`);
        return this.finishTask(task, result.state, result.message || result.state);
      } catch (error) {
        task.lastError = error.message;
        this.emitEvent("task.retry", { taskId: task.id, attempt: task.attempts, error: error.message });
        if (attempt >= task.retryLimit) return this.finishTask(task, "failed", error.message);
      }
    }
    return this.finishTask(task, "failed", "超过重试次数");
  }

  finishTask(task, state, message) {
    task.state = state;
    task.lastError = state === "failed" ? message : null;
    const result = { taskId: task.id, definitionId: task.definitionId, state, message, attempts: task.attempts };
    this.emitEvent(`task.${state}`, result);
    this.activeTask = null;
    return result;
  }

  emitEvent(type, payload) {
    this.emit("event", { type, at: this.clock().toISOString(), state: this.state, payload });
  }
}

module.exports = { TaskScheduler, terminalStates };
