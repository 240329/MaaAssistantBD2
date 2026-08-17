const tasks = [
  { id: "daily", name: "每日领取", meta: "邮箱 / 任务奖励 / 通行证", type: "日常" },
  { id: "guild", name: "公会与女神像", meta: "签到 / 亲密度", type: "社交" },
  { id: "harvest", name: "收菜与吸取", meta: "收集物 / 葛罗提", type: "收集" },
  { id: "shop", name: "商店采购", meta: "活动商店 / 广场商品", type: "商店" },
  { id: "battle", name: "今日战斗", meta: "米饭 / 火把 / 狩猎场", type: "战斗" },
  { id: "pvp", name: "自动 PVP", meta: "规划中，需人工确认", type: "竞技" }
];

const catalog = [
  ["✦", "每日自动抽角色", "每日抽取角色并预留资源阈值。"], ["◈", "自动抽武器", "武器抽取策略与次数限制。"], ["⌁", "公会签到", "进入公会页面并完成签到。"], ["◌", "邮箱领取", "批量领取邮件附件。"], ["▣", "通行证领取", "检查并领取可用奖励。"], ["♢", "魔兽挑战", "挑战流程与结果识别。"], ["✚", "活动战斗", "活动关卡与次数控制。"], ["▤", "活动商店购买", "按优先级和资源上限购买。"], ["◎", "收集物吸取", "地图收集物识别与吸取。"], ["⌂", "酒馆亲密度", "执行互动并追踪可用次数。"], ["⚔", "自动 PVP", "队伍策略与赛季次数控制。"], ["◫", "每周地图任务", "每周目标和完成状态追踪。"]
];

const taskList = document.querySelector("#taskList");
const configContent = document.querySelector("#configContent");
const log = document.querySelector("#consoleLog");
const progress = document.querySelector("#progressBar");
const toast = document.querySelector("#toast");
let selectedTask = tasks[0];
let running = false;
let timer;
let boundWindow = null;

function renderTasks() {
  taskList.innerHTML = tasks.map((task, index) => `<div class="task-row ${task.id === selectedTask.id ? "selected" : ""}" data-id="${task.id}"><span class="drag">⠿</span><label><input type="checkbox" checked /> <span class="task-name">${index + 1}. ${task.name}</span><span class="task-meta">${task.meta}</span></label><span class="task-badge">${task.type}</span></div>`).join("");
  document.querySelectorAll(".task-row").forEach((row) => row.addEventListener("click", () => {
    selectedTask = tasks.find((task) => task.id === row.dataset.id);
    renderTasks();
    renderConfig();
  }));
  document.querySelector("#taskCount").textContent = `${tasks.length} 项`;
}

function renderConfig() {
  configContent.innerHTML = `<div class="config-kicker">${selectedTask.type} / ${selectedTask.id.toUpperCase()}</div><h4>${selectedTask.name}</h4><div class="config-note">${selectedTask.meta}<br />该功能已登记到规划中，具体游戏逻辑将在 Win32 绑定验证后接入。</div><div class="field"><span>任务状态</span><strong>模拟可用</strong></div><div class="field"><span>失败处理</span><strong>停止并保留截图</strong></div><div class="field"><span>运行次数</span><strong>待配置</strong></div><div class="field"><span>资源限制</span><strong>待配置</strong></div>`;
}

function renderCatalog() {
  document.querySelector("#catalogGrid").innerHTML = catalog.map(([icon, title, description]) => `<article class="catalog-card"><div class="card-icon">${icon}</div><h4>${title}</h4><p>${description}</p><span class="planned">规划中</span></article>`).join("");
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
    preview.innerHTML = `<img src="data:image/png;base64,${data.image}" alt="目标窗口客户区截图" />`;
    document.querySelector("#captureMeta").textContent = `${data.width} × ${data.height} / ${data.dpi} DPI`;
    document.querySelector("#diagCapture").textContent = "CopyFromScreen";
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
  let step = 0;
  document.querySelector("#runSimulation").disabled = true;
  document.querySelector("#stopSimulation").disabled = false;
  document.querySelector("#runState").textContent = "模拟运行中";
  document.querySelector("#runDetail").textContent = "不会发送游戏输入";
  addLog("模拟任务队列已开始。", "success");
  timer = setInterval(() => {
    step += 1;
    const current = tasks[(step - 1) % tasks.length];
    progress.style.width = `${Math.min(step / tasks.length * 100, 100)}%`;
    document.querySelector("#runDetail").textContent = `正在检查：${current.name}`;
    addLog(`已模拟检查「${current.name}」：等待真实流程接入。`);
    if (step >= tasks.length) stopSimulation(true);
  }, 650);
}

function stopSimulation(completed = false) {
  clearInterval(timer);
  running = false;
  document.querySelector("#runSimulation").disabled = false;
  document.querySelector("#stopSimulation").disabled = true;
  document.querySelector("#runState").textContent = completed ? "模拟完成" : "已停止";
  document.querySelector("#runDetail").textContent = completed ? "任务事件已全部生成" : "等待下一次运行";
  if (completed) { document.querySelector("#completedCount").textContent = tasks.length; addLog("模拟队列完成，没有执行真实输入。", "success"); }
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
document.querySelector("#selectAll").addEventListener("click", () => document.querySelectorAll(".task-row input").forEach((input) => { input.checked = true; }));
document.querySelector("#clearAll").addEventListener("click", () => document.querySelectorAll(".task-row input").forEach((input) => { input.checked = false; }));
document.querySelector("#addTask").addEventListener("click", () => showToast("自定义任务将在后续阶段开放"));
document.querySelector("#openBinding").addEventListener("click", () => { document.querySelector('[data-view="binding"]').click(); showToast("请扫描并选择目标游戏窗口"); });
document.querySelector("#scanWindows").addEventListener("click", scanWindows);
document.querySelector("#refreshWindows").addEventListener("click", scanWindows);
document.querySelector("#captureWindow").addEventListener("click", captureBoundWindow);
setInterval(checkBoundWindow, 3000);

renderTasks();
renderConfig();
renderCatalog();
