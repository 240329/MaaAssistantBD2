const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const root = path.join(__dirname, "web");
const port = Number(process.env.PORT || 4173);
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

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

function createServer() {
  return http.createServer((request, response) => {
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

module.exports = { createServer, enumerateWindows };
