const fs = require("fs");
const path = require("path");
const { createDefaultPlan } = require("./task-definitions");

class PlanStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const plan = createDefaultPlan();
      this.save(plan);
      return plan;
    }
  }

  save(plan) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, this.filePath);
    return plan;
  }
}

module.exports = { PlanStore };
