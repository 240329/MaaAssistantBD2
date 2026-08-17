const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { CoordinateMapper } = require("./src/core/coordinate-mapper");
const { taskDefinitions } = require("./src/tasks/task-definitions");
const { TaskScheduler } = require("./src/tasks/task-scheduler");
const { PlanStore } = require("./src/tasks/plan-store");

const root = path.join(__dirname, "web");
const port = Number(process.env.PORT || 4173);
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};
const planStore = new PlanStore(path.join(__dirname, "data", "task-plan.json"));
const scheduler = new TaskScheduler({ resourceRoot: __dirname });
scheduler.loadPlan(planStore.load());
const eventJournal = [];
scheduler.on("event", (event) => {
  eventJournal.push(event);
  if (eventJournal.length > 500) eventJournal.shift();
});

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function readJson(request, callback) {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > 1024 * 1024) request.destroy(new Error("请求内容过大"));
  });
  request.on("end", () => {
    try { callback(null, body ? JSON.parse(body) : {}); } catch (error) { callback(error); }
  });
  request.on("error", callback);
}

const windowScript = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NativeWindows {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$items = [System.Collections.Generic.List[object]]::new()
[NativeWindows]::EnumWindows({ param($hWnd, $lParam)
  if (-not [NativeWindows]::IsWindowVisible($hWnd)) { return $true }
  $titleBuffer = [Text.StringBuilder]::new(512)
  $classBuffer = [Text.StringBuilder]::new(256)
  [NativeWindows]::GetWindowText($hWnd, $titleBuffer, $titleBuffer.Capacity) | Out-Null
  [NativeWindows]::GetClassName($hWnd, $classBuffer, $classBuffer.Capacity) | Out-Null
  $title = $titleBuffer.ToString().Trim()
  if ([string]::IsNullOrWhiteSpace($title)) { return $true }
  [uint32]$processId = 0
  [NativeWindows]::GetWindowThreadProcessId($hWnd, [ref]$processId) | Out-Null
  $processName = "unknown"
  try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch {}
  $rect = New-Object NativeWindows+RECT
  [NativeWindows]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
  $items.Add([pscustomobject]@{
    hwnd = $hWnd.ToInt64().ToString()
    title = $title
    className = $classBuffer.ToString()
    processId = $processId
    processName = $processName
    rect = @{ left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom }
  })
  return $true
}, [IntPtr]::Zero) | Out-Null
$items | ConvertTo-Json -Compress -Depth 4
`;

const captureScript = `
param([Int64]$Hwnd)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeCapture {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@
$window = [IntPtr]::new($Hwnd)
if (-not [NativeCapture]::IsWindow($window) -or -not [NativeCapture]::IsWindowVisible($window)) { throw "目标窗口不存在或不可见" }
$rect = New-Object NativeCapture+RECT
if (-not [NativeCapture]::GetClientRect($window, [ref]$rect)) { throw "无法读取目标窗口客户区" }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw "目标窗口客户区无有效尺寸" }
$origin = New-Object NativeCapture+POINT
if (-not [NativeCapture]::ClientToScreen($window, [ref]$origin)) { throw "无法换算客户区坐标" }
$bitmap = [Drawing.Bitmap]::new($width, $height)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($origin.X, $origin.Y, 0, 0, $bitmap.Size)
  $stream = [IO.MemoryStream]::new()
  try {
    $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    [pscustomobject]@{
      width = $width
      height = $height
      dpi = [NativeCapture]::GetDpiForWindow($window)
      image = [Convert]::ToBase64String($stream.ToArray())
    } | ConvertTo-Json -Compress
  } finally { $stream.Dispose() }
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
`;

function enumerateWindows(callback) {
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", windowScript], { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      callback(new Error(stderr.trim() || error.message));
      return;
    }
    try {
      const parsed = stdout.trim() ? JSON.parse(stdout) : [];
      callback(null, Array.isArray(parsed) ? parsed : [parsed]);
    } catch (parseError) {
      callback(parseError);
    }
  });
}

function captureWindow(hwnd, callback) {
  if (!/^\d+$/.test(hwnd)) {
    callback(new Error("窗口句柄格式无效"));
    return;
  }
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", captureScript, "-Hwnd", hwnd], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      callback(new Error(stderr.trim() || error.message));
      return;
    }
    try {
      callback(null, JSON.parse(stdout));
    } catch (parseError) {
      callback(parseError);
    }
  });
}

function createServer() {
  return http.createServer((request, response) => {
  const requestUrl = new URL(request.url, "http://127.0.0.1");
  if (request.method === "GET" && requestUrl.pathname === "/api/tasks") {
    sendJson(response, 200, { definitions: taskDefinitions, plan: scheduler.getPlan(), state: scheduler.state });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/plan") {
    sendJson(response, 200, { plan: scheduler.getPlan(), state: scheduler.state });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/events") {
    sendJson(response, 200, { events: eventJournal.slice(-200), state: scheduler.state });
    return;
  }

  if (request.method === "PUT" && requestUrl.pathname === "/api/plan") {
    readJson(request, (error, plan) => {
      if (error) { sendJson(response, 400, { error: "任务计划 JSON 无效" }); return; }
      try {
        const saved = scheduler.updatePlan(plan);
        planStore.save(saved);
        sendJson(response, 200, { plan: saved });
      } catch (updateError) { sendJson(response, 400, { error: "任务计划无效", detail: updateError.message }); }
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/run") {
    const eventOffset = eventJournal.length;
    scheduler.run({ delayMs: 80 }).then((result) => sendJson(response, 200, { ...result, events: eventJournal.slice(eventOffset) })).catch((error) => sendJson(response, 409, { error: error.message }));
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/stop") {
    scheduler.requestCancel();
    sendJson(response, 202, { state: scheduler.state });
    return;
  }

  if (request.url === "/api/windows") {
    enumerateWindows((error, windows) => {
      if (error) {
        response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "无法枚举 Windows 窗口", detail: error.message }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ windows }));
    });
    return;
  }

  if (requestUrl.pathname === "/api/coordinates/map") {
    const logicalWidth = Number(requestUrl.searchParams.get("logicalWidth") || 1920);
    const logicalHeight = Number(requestUrl.searchParams.get("logicalHeight") || 1080);
    const clientWidth = Number(requestUrl.searchParams.get("clientWidth"));
    const clientHeight = Number(requestUrl.searchParams.get("clientHeight"));
    try {
      const mapper = new CoordinateMapper(logicalWidth, logicalHeight);
      const transform = mapper.getTransform(clientWidth, clientHeight);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ logicalWidth, logicalHeight, clientWidth, clientHeight, ...transform }));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "坐标映射参数无效", detail: error.message }));
    }
    return;
  }

  const captureMatch = request.url.match(/^\/api\/windows\/(\d+)\/capture$/);
  if (captureMatch) {
    captureWindow(captureMatch[1], (error, capture) => {
      if (error) {
        response.writeHead(422, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "无法捕获目标窗口", detail: error.message }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify(capture));
    });
    return;
  }

  const requested = request.url === "/" ? "/index.html" : request.url;
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mime[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(data);
  });
  });
}

if (require.main === module) {
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`BD2 Assistant UI: http://127.0.0.1:${port}`);
  });
}

module.exports = { createServer, captureWindow, enumerateWindows, scheduler, planStore, eventJournal };
