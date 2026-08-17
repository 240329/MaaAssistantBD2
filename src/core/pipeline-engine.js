class PipelineEngine {
  constructor({ controller, vision, maxTransitions = 100 } = {}) {
    if (!controller || !vision) throw new Error("PipelineEngine 需要 controller 和 vision");
    this.controller = controller;
    this.vision = vision;
    this.maxTransitions = maxTransitions;
  }

  async run(pipeline, context = {}) {
    if (!pipeline || !pipeline.start || !pipeline.nodes) throw new Error("流程资源格式无效");
    let nodeId = pipeline.start;
    const trace = [];

    for (let transitions = 0; nodeId; transitions += 1) {
      if (transitions >= this.maxTransitions) return { state: "failed", reason: "流程超过最大转换次数", trace };
      if (context.signal?.aborted) return { state: "cancelled", reason: "流程已取消", trace };
      const node = pipeline.nodes[nodeId];
      if (!node) return { state: "failed", reason: `流程节点不存在：${nodeId}`, trace };

      const screenshot = await this.controller.screenshot();
      const detection = await this.vision.detect(node.detect || { type: "always" }, screenshot, context);
      trace.push({ nodeId, detection });

      if (!detection.matched) {
        if (detection.status === "todo") return { state: "todo", reason: detection.reason, trace };
        nodeId = node.onError || null;
        if (!nodeId) return { state: "failed", reason: `节点未匹配：${nodeId || trace.at(-1).nodeId}`, trace };
        continue;
      }

      if (node.action) {
        const handler = this.controller[node.action.type];
        if (typeof handler !== "function") return { state: "todo", reason: `TODO: Controller 不支持动作 ${node.action.type}`, trace };
        const actionResult = await handler.call(this.controller, node.action);
        if (actionResult?.accepted === false) return { state: "blocked", reason: actionResult.reason || "动作被 Controller 拒绝", trace };
      }
      nodeId = node.next || null;
    }
    return { state: "completed", trace };
  }
}

module.exports = { PipelineEngine };
