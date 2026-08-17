class CoordinateMapper {
  constructor(logicalWidth, logicalHeight) {
    if (!Number.isFinite(logicalWidth) || !Number.isFinite(logicalHeight) || logicalWidth <= 0 || logicalHeight <= 0) {
      throw new Error("逻辑画布尺寸必须为正数");
    }
    this.logicalWidth = logicalWidth;
    this.logicalHeight = logicalHeight;
  }

  getTransform(clientWidth, clientHeight) {
    if (!Number.isFinite(clientWidth) || !Number.isFinite(clientHeight) || clientWidth <= 0 || clientHeight <= 0) {
      throw new Error("客户区尺寸必须为正数");
    }
    const scale = Math.min(clientWidth / this.logicalWidth, clientHeight / this.logicalHeight);
    const renderedWidth = this.logicalWidth * scale;
    const renderedHeight = this.logicalHeight * scale;
    return {
      scale,
      offsetX: (clientWidth - renderedWidth) / 2,
      offsetY: (clientHeight - renderedHeight) / 2,
      renderedWidth,
      renderedHeight
    };
  }

  logicalToClient(point, clientWidth, clientHeight) {
    const transform = this.getTransform(clientWidth, clientHeight);
    return {
      x: transform.offsetX + point.x * transform.scale,
      y: transform.offsetY + point.y * transform.scale,
      inCanvas: point.x >= 0 && point.x <= this.logicalWidth && point.y >= 0 && point.y <= this.logicalHeight
    };
  }

  clientToLogical(point, clientWidth, clientHeight) {
    const transform = this.getTransform(clientWidth, clientHeight);
    return {
      x: (point.x - transform.offsetX) / transform.scale,
      y: (point.y - transform.offsetY) / transform.scale,
      inCanvas: point.x >= transform.offsetX && point.x <= transform.offsetX + transform.renderedWidth && point.y >= transform.offsetY && point.y <= transform.offsetY + transform.renderedHeight
    };
  }
}

module.exports = { CoordinateMapper };
