class FakeController {
  constructor({ width, height } = {}) {
    this.clientSize = { width: width || 0, height: height || 0 };
    this.calls = [];
  }

  setClientSize(width, height) {
    this.clientSize = { width, height };
    this.calls.push({ type: "setClientSize", width, height });
  }

  screenshot() {
    this.calls.push({ type: "screenshot", ...this.clientSize });
    return { kind: "fake-screenshot", ...this.clientSize };
  }

  click(point) {
    this.calls.push({ type: "click", ...point });
    return { accepted: false, reason: "fake-controller" };
  }
}

module.exports = { FakeController };
