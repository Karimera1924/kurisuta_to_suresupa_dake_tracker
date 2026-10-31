// Win32 の前面窓・プロセス名・最終入力時刻を取得する（koffi 経由）。
// 外部に出すのは observe() だけ。koffi の型や HANDLE は見せない。
const koffi = require("koffi");
const path = require("node:path");

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TITLE_CHARS = 512;
const IMAGE_PATH_CHARS = 32768;
const UINT32_SPAN = 0x100000000;

const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");

// 下の GetLastInputInfo の宣言文字列から名前で参照されるため、登録だけ行う
koffi.struct("LASTINPUTINFO", {
  cbSize: "uint32",
  dwTime: "uint32",
});

const GetForegroundWindow = user32.func("void* GetForegroundWindow()");
const GetWindowTextW = user32.func(
  "int GetWindowTextW(void* hWnd, _Out_ uint8_t* lpString, int nMaxCount)",
);
const GetWindowThreadProcessId = user32.func(
  "uint32 GetWindowThreadProcessId(void* hWnd, _Out_ uint8_t* lpdwProcessId)",
);
const GetLastInputInfo = user32.func(
  "bool GetLastInputInfo(_Inout_ LASTINPUTINFO* plii)",
);
const GetTickCount64 = kernel32.func("uint64 GetTickCount64()");
const OpenProcess = kernel32.func(
  "void* OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)",
);
const QueryFullProcessImageNameW = kernel32.func(
  "bool QueryFullProcessImageNameW(void* hProcess, uint32 dwFlags, _Out_ uint8_t* lpExeName, _Inout_ uint32* lpdwSize)",
);
const CloseHandle = kernel32.func("bool CloseHandle(void* hObject)");

// UTF-16 のバッファから、ヌル終端までの文字列を取り出す
function readWide(buf, charCount) {
  const text = buf.toString("utf16le", 0, charCount * 2);
  const nul = text.indexOf("\0");
  return nul === -1 ? text : text.slice(0, nul);
}

function windowTitle(hwnd) {
  const buf = Buffer.alloc(TITLE_CHARS * 2);
  const n = GetWindowTextW(hwnd, buf, TITLE_CHARS);
  return n > 0 ? readWide(buf, n) : "";
}

// 拡張子無しのプロセス名（例: ClipStudioPaint）。権限不足で開けない場合は空文字。
function processName(pid) {
  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!handle) return "";
  try {
    const buf = Buffer.alloc(IMAGE_PATH_CHARS * 2);
    const size = [IMAGE_PATH_CHARS];
    if (!QueryFullProcessImageNameW(handle, 0, buf, size)) return "";
    return path.basename(readWide(buf, size[0]), ".exe");
  } finally {
    CloseHandle(handle);
  }
}

function foregroundWindow() {
  const hwnd = GetForegroundWindow();
  if (!hwnd) return null;
  const pidBuf = Buffer.alloc(4);
  GetWindowThreadProcessId(hwnd, pidBuf);
  return {
    processName: processName(pidBuf.readUInt32LE(0)),
    title: windowTitle(hwnd),
  };
}

// 最終入力からの経過ミリ秒。dwTime は 32 bit なので、GetTickCount64 の下位 32 bit と引き算する。
function idleMs() {
  const info = { cbSize: 8, dwTime: 0 };
  if (!GetLastInputInfo(info)) return 0;
  const nowLow = Number(GetTickCount64()) % UINT32_SPAN;
  return (nowLow - info.dwTime + UINT32_SPAN) % UINT32_SPAN;
}

// 戻り値: { foreground: {processName, title} | null, idleMs }
// 失敗しても例外は投げず、前面なし・待機 0 として返す（計測ループを止めないため）。
function observe() {
  try {
    return { foreground: foregroundWindow(), idleMs: idleMs() };
  } catch {
    return { foreground: null, idleMs: 0 };
  }
}

module.exports = { observe };
