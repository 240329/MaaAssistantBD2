class VisionService {
  constructor() {
    this.detectors = new Map();
  }

  register(type, detector) {
    if (!type || typeof detector !== "function") throw new Error("识别器定义无效");
    this.detectors.set(type, detector);
  }

  async detect(specification, screenshot, context = {}) {
    if (!specification || !specification.type) throw new Error("识别规则缺少 type");
    const detector = this.detectors.get(specification.type);
    if (!detector) {
      return { matched: false, status: "todo", reason: `TODO: 未注册识别器 ${specification.type}` };
    }
    return detector(specification, screenshot, context);
  }
}

module.exports = { VisionService };
