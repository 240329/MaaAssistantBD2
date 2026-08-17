const fs = require("fs");
const path = require("path");

function loadTaskResource(definition, rootDirectory) {
  const resourcePath = path.join(rootDirectory, definition.resource);
  try {
    const data = JSON.parse(fs.readFileSync(resourcePath, "utf8"));
    return { available: true, path: resourcePath, data };
  } catch (error) {
    return {
      available: false,
      path: resourcePath,
      data: {
        status: "todo",
        message: definition.logic,
        error: error.code === "ENOENT" ? "resource-not-created" : "resource-invalid"
      }
    };
  }
}

module.exports = { loadTaskResource };
