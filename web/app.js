let tasks = [];
let definitions = [];

const taskList = document.querySelector("#taskList");
const configContent = document.querySelector("#configContent");
const log = document.querySelector("#consoleLog");
const progress = document.querySelector("#progressBar");
const toast = document.querySelector("#toast");
let selectedTask = null;
let running = false;
let boundWindow = null;

function renderTasks() {
  taskList.innerHTML = tasks.map((task, index) => `<div class="task-row ${task.id === selectedTask?.id ? "selected" : ""}" data-id="${task.id}"><span class="drag">⠿</span><label><input class="task-enabled" type="checkbox" ${task.enabled ? "checked" : ""} /> <span class="task-name">${index + 1}. ${task.name}</span><span class="task-meta">${task.meta}</span></label><span class="task-actions"><button title="上移" data-action="up">↑</button><button title="下移" data-action="down">↓</button><button title="删除" data-action="remove">×</button></span></div>`).join("");
  document.querySelectorAll(".task-row").forEach((row) => row.addEventListener("click", () => {
    selectedTask = tasks.find((task) => task.id === row.dataset.id);
    renderTasks();
    renderConfig();
  }));
  document.querySelectorAll(".task-enabled").forEach((input) => input.addEventListener("click", (event) => {
    event.stopPropagation();
    const task = tasks.find((item) => item.id === input.closest(".task-row").dataset.id);
    task.enabled = input.checked;
    savePlan();
  }));
  document.querySelectorAll(".task-actions button").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    editTaskOrder(button.closest(".task-row").dataset.id, button.dataset.action);
  }));
  document.querySelector("#taskCount").textContent = `${tasks.length} 项`;
}

function renderConfig() {
  const definition = definitions.find((item) => item.id === selectedTask.definitionId);
  configContent.innerHTML = `<div class="config-kicker">${definition.group} / ${definition.id.toUpperCase()}</div><h4>${definition.name}</h4><div class="config-note">${definition.description}<br />${definition.logic}</div><div class="field"><span>任务状态</span><strong>TODO 占位</strong></div><div class="field"><span>资源文件</span><strong>${definition.resource}</strong></div><div class="field"><span>失败处理</span><strong>停止并保留诊断</strong></div><div class="field"><span>重试次数</span><strong>${selectedTask.retryLimit}</strong></div>`;
}

function renderCatalog() {
  const icons = ["✦", "◈", "⌁", "◌", "▣", "♢", "✚", "▤", "◎", "⌂", "⚔", "◫"];
  document.querySelector("#catalogGrid").innerHTML = definitions.map((definition, index) => `<article class="catalog-card"><div class="card-icon">${icons[index % icons.length]}</div><h4>${definition.name}</h4><p>${definition.description}</p><div class="catalog-footer"><span class="planned">TODO · ${definition.group}</span><button data-definition="${definition.id}">加入队列</button></div></article>`).join("");
  document.querySelectorAll(".catalog-footer button").forEach((button) => button.addEventListener("click", () => addTask(button.dataset.definition)));
}

function serializePlan() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    tasks: tasks.map(({ id, definitionId, enabled, parameters, retryLimit }) => ({ id, definitionId, enabled, parameters, retryLimit }))
  };
}

async function savePlan() {
  const response = await fetch("/api/plan", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(serializePlan()) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.detail || result.error || "计划保存失败");
  showToast("任务计划已保存");
}

function addTask(definitionId) {
  const definition = definitions.find((item) => item.id === definitionId);
  const task = { id: `${definitionId}-${Date.now()}`, definitionId, enabled: true, parameters: {}, retryLimit: definition.retryLimit, name: definition.name, meta: definition.description, type: definition.group };
  tasks.push(task);
  selectedTask = task;
  renderTasks();
  renderConfig();
  savePlan().catch((error) => showToast(error.message));
}

function editTaskOrder(id, action) {
  const index = tasks.findIndex((task) => task.id === id);
  if (action === "remove") {
    tasks.splice(index, 1);
    selectedTask = tasks[Math.min(index, tasks.length - 1)] || null;
  } else {
    const target = action === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= tasks.length) return;
    [tasks[index], tasks[target]] = [tasks[target], tasks[index]];
  }
  renderTasks();
  if (selectedTask) renderConfig(); else configContent.innerHTML = `<div class="config-note">从功能目录添加任务以开始编排。</div>`;
  savePlan().catch((error) => showToast(error.message));
}

async function loadTaskModel() {
  const response = await fetch("/api/tasks");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "任务模型加载失败");
  definitions = data.definitions;
  tasks = data.plan.tasks.map((task) => {
    const definition = definitions.find((item) => item.id === task.definitionId);
    return { ...task, name: definition.name, meta: definition.description, type: definition.group };
  });
  selectedTask = tasks[0];
  renderTasks();
  renderConfig();
  renderCatalog();
  document.querySelector("#completedCount").textContent = definitions.length;
}

function addLog(message, tone = "") {
  const now = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  log.insertAdjacentHTML("beforeend", `<div class="log-entry ${tone}"><time>${now}</time><span>${message}</span></div>`);
  log.scrollTop = log.scrollHeight;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function renderWindows(windows) {
  const list = document.querySelector("#windowList");
  if (!windows.length) {
    list.innerHTML = `<div class="window-glyph">⌗</div><strong>没有可用窗口</strong><span>请确认目标程序正在运行，并拥有可见的顶层窗口。</span><button class="secondary-button" id="scanWindows">重新扫描</button>`;
    document.querySelector("#scanWindows").addEventListener("click", scanWindows);
    return;
  }
  list.classList.remove("window-placeholder");
  list.classList.add("window-list");
  list.innerHTML = windows.map((window) => `<button class="window-option ${boundWindow?.hwnd === window.hwnd ? "selected" : ""}" data-hwnd="${window.hwnd}"><span><strong>${window.title}</strong><span>${window.processName}.exe · ${window.className || "无类名"}</span></span><b>绑定</b></button>`).join("");
  document.querySelectorAll(".window-option").forEach((option) => option.addEventListener("click", () => bindWindow(windows.find((window) => window.hwnd === option.dataset.hwnd))));
}

function updateBindingDiagnostics(window) {
  document.querySelector("#bindingState").textContent = window ? `已绑定：${window.title}` : "未绑定游戏窗口";
  document.querySelector("#bindingTag").textContent = window ? "已绑定" : "待连接";
  document.querySelector("#diagHwnd").textContent = window?.hwnd || "—";
  document.querySelector("#diagProcess").textContent = window ? `${window.processName}.exe (${window.processId})` : "—";
  document.querySelector("#diagClass").textContent = window?.className || "—";
  document.querySelector("#diagRect").textContent = window ? `${window.rect.right - window.rect.left} × ${window.rect.bottom - window.rect.top}` : "—";
  document.querySelector("#diagDpi").textContent = window?.dpi ? `${window.dpi} DPI` : "待捕获";
  document.querySelector("#captureWindow").disabled = !window;
  document.querySelector("#captureMeta").textContent = window ? "客户区 / 只读诊断" : "等待绑定";
}

function bindWindow(window) {
  boundWindow = window;
  updateBindingDiagnostics(window);
  renderWindows([window]);
  addLog(`已绑定窗口「${window.title}」，当前仅启用窗口信息读取。`);
  showToast("窗口绑定成功，截图和输入将在后续阶段接入");
}

async function checkBoundWindow() {
  if (!boundWindow) return;
  try {
    const response = await fetch("/api/windows");
    const data = await response.json();
    const current = data.windows.find((window) => window.hwnd === boundWindow.hwnd);
    if (!current) {
      const previousTitle = boundWindow.title;
      boundWindow = null;
      updateBindingDiagnostics(null);
      document.querySelector("#windowList").className = "window-placeholder";
      document.querySelector("#windowList").innerHTML = `<div class="window-glyph">!</div><strong>绑定已失效</strong><span>窗口「${previousTitle}」已关闭或不再可见。</span><button class="secondary-button" id="scanWindows">重新扫描</button>`;
      document.querySelector("#scanWindows").addEventListener("click", scanWindows);
      addLog(`绑定窗口「${previousTitle}」已失效，任务保持停止。`);
      showToast("绑定窗口已失效");
    }
  } catch {
    // A temporary backend failure must not discard an otherwise valid binding.
  }
}

async function scanWindows() {
  const list = document.querySelector("#windowList");
  list.className = "window-placeholder";
  list.innerHTML = `<div class="window-glyph">…</div><strong>正在扫描窗口</strong><span>读取当前桌面的可见顶层窗口</span>`;
  try {
    const response = await fetch("/api/windows");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "窗口扫描失败");
    renderWindows(data.windows);
    showToast(`已发现 ${data.windows.length} 个可见窗口`);
  } catch (error) {
    list.innerHTML = `<div class="window-glyph">!</div><strong>扫描失败</strong><span>${error.message}</span><button class="secondary-button" id="scanWindows">重试</button>`;
    document.querySelector("#scanWindows").addEventListener("click", scanWindows);
    showToast("窗口扫描失败，请查看服务端日志");
  }
}

async function captureBoundWindow() {
  if (!boundWindow) return;
  const button = document.querySelector("#captureWindow");
  const preview = document.querySelector("#capturePreview");
  button.disabled = true;
  button.textContent = "正在捕获…";
  try {
    const response = await fetch(`/api/windows/${boundWindow.hwnd}/capture`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || "截图失败");
    boundWindow.dpi = data.dpi;
    updateBindingDiagnostics(boundWindow);
    const mapResponse = await fetch(`/api/coordinates/map?logicalWidth=1920&logicalHeight=1080&clientWidth=${data.width}&clientHeight=${data.height}`);
    const mapping = await mapResponse.json();
    if (!mapResponse.ok) throw new Error(mapping.detail || mapping.error || "坐标映射失败");
    preview.innerHTML = `<img src="data:image/png;base64,${data.image}" alt="目标窗口客户区截图" />`;
    document.querySelector("#captureMeta").textContent = `${data.width} × ${data.height} / ${data.dpi} DPI`;
    document.querySelector("#diagCapture").textContent = "CopyFromScreen";
    const values = document.querySelectorAll("#mappingStrip strong");
    values[1].textContent = `${mapping.scale.toFixed(4)}×`;
    values[2].textContent = `${Math.round(mapping.offsetX)}, ${Math.round(mapping.offsetY)}`;
    values[3].textContent = `${Math.round(mapping.renderedWidth)} × ${Math.round(mapping.renderedHeight)}`;
    addLog(`已捕获客户区截图：${data.width} × ${data.height}，未发送输入。`);
  } catch (error) {
    preview.innerHTML = `<div class="preview-mark">!</div><span>${error.message}</span>`;
    document.querySelector("#diagCapture").textContent = "捕获失败";
    showToast("客户区截图失败");
  } finally {
    button.disabled = !boundWindow;
    button.textContent = "▣ 捕获客户区截图";
  }
}

function runSimulation() {
  if (running) return;
  running = true;
  document.querySelector("#runSimulation").disabled = true;
  document.querySelector("#stopSimulation").disabled = false;
  document.querySelector("#runState").textContent = "模拟运行中";
  document.querySelector("#runDetail").textContent = "不会发送游戏输入";
  progress.style.width = "20%";
  addLog("后端任务调度器已开始，所有资源仍为 TODO 占位。", "success");
  fetch("/api/run", { method: "POST" })
    .then((response) => response.json().then((result) => ({ response, result })))
    .then(({ response, result }) => {
      if (!response.ok) throw new Error(result.error || "任务调度失败");
      result.results.forEach((item) => addLog(`「${item.definitionId}」${item.state}：${item.message}`));
      stopSimulation(result.state === "idle");
    })
    .catch((error) => { addLog(`调度失败：${error.message}`); stopSimulation(false); });
}

function stopSimulation(completed = false) {
  if (running && !completed) fetch("/api/stop", { method: "POST" }).catch(() => {});
  running = false;
  document.querySelector("#runSimulation").disabled = false;
  document.querySelector("#stopSimulation").disabled = true;
  document.querySelector("#runState").textContent = completed ? "模拟完成" : "已停止";
  document.querySelector("#runDetail").textContent = completed ? "任务事件已全部生成" : "等待下一次运行";
  progress.style.width = completed ? "100%" : "0";
  if (completed) addLog("任务计划完成：未执行真实游戏输入。", "success");
}

document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => {
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.remove("active"));
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  item.classList.add("active");
  document.querySelector(`#${item.dataset.view}View`).classList.add("active");
  document.querySelector("#pageTitle").textContent = { overview: "今日任务", catalog: "功能目录", binding: "窗口绑定", settings: "设置" }[item.dataset.view];
}));

document.querySelector("#runSimulation").addEventListener("click", runSimulation);
document.querySelector("#stopSimulation").addEventListener("click", () => stopSimulation());
document.querySelector("#selectAll").addEventListener("click", () => { tasks.forEach((task) => { task.enabled = true; }); renderTasks(); savePlan().catch((error) => showToast(error.message)); });
document.querySelector("#clearAll").addEventListener("click", () => { tasks.forEach((task) => { task.enabled = false; }); renderTasks(); savePlan().catch((error) => showToast(error.message)); });
document.querySelector("#addTask").addEventListener("click", () => { document.querySelector('[data-view="catalog"]').click(); showToast("从功能目录选择任务"); });
document.querySelector("#openBinding").addEventListener("click", () => { document.querySelector('[data-view="binding"]').click(); showToast("请扫描并选择目标游戏窗口"); });
document.querySelector("#scanWindows").addEventListener("click", scanWindows);
document.querySelector("#refreshWindows").addEventListener("click", scanWindows);
document.querySelector("#captureWindow").addEventListener("click", captureBoundWindow);
setInterval(checkBoundWindow, 3000);

loadTaskModel().catch((error) => {
  addLog(`任务模型加载失败：${error.message}`);
  document.querySelector("#runSimulation").disabled = true;
});
