"""タスクバー右側（通知領域のすぐ左）に、対象ごとの今日の合計を出すオーバーレイ。

タスクバーの上に重ねる最前面の窓（子ウィンドウにはしない）。
子ウィンドウだとタスクバーの描画層の裏に回るため。
窓の右端を通知領域（TrayNotifyWnd）の左端に揃え、高さはタスクバーに合わせる。
Windows のウィジェット機能とは別物。
"""

import ctypes
import os
import tempfile
import winreg
from ctypes import wintypes
from datetime import datetime

user32 = ctypes.WinDLL("user32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
shcore = ctypes.WinDLL("shcore", use_last_error=True)

HANDLE = ctypes.c_void_p
LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(
    LRESULT, HANDLE, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
)

WS_POPUP = 0x80000000
WS_EX_TOPMOST = 0x00000008
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_NOACTIVATE = 0x08000000
HWND_TOPMOST = -1
HWND_MESSAGE = -3
SWP_NOACTIVATE = 0x0010
SWP_SHOWWINDOW = 0x0040
WM_PAINT = 0x000F
WM_LBUTTONUP = 0x0202
WM_APP = 0x8000
MSG_REFRESH = WM_APP + 1
MSG_STOP = WM_APP + 2
DT_CENTER = 0x01
DT_VCENTER = 0x04
DT_SINGLELINE = 0x20
TRANSPARENT = 1
FW_NORMAL = 400
DEFAULT_CHARSET = 1
CLEARTYPE_QUALITY = 5
CLASS_NAME = "AppTimeOverlay"
TASKBAR_CLASS = "Shell_TrayWnd"
TRAY_NOTIFY_CLASS = "TrayNotifyWnd"
PROCESS_PER_MONITOR_DPI_AWARE = 2


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]


class POINT(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]


class PAINTSTRUCT(ctypes.Structure):
    _fields_ = [
        ("hdc", HANDLE),
        ("fErase", wintypes.BOOL),
        ("rcPaint", RECT),
        ("fRestore", wintypes.BOOL),
        ("fIncUpdate", wintypes.BOOL),
        ("rgbReserved", ctypes.c_byte * 32),
    ]


class WNDCLASSW(ctypes.Structure):
    _fields_ = [
        ("style", wintypes.UINT),
        ("lpfnWndProc", WNDPROC),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", HANDLE),
        ("hIcon", HANDLE),
        ("hCursor", HANDLE),
        ("hbrBackground", HANDLE),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
    ]


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", HANDLE),
        ("message", wintypes.UINT),
        ("wParam", wintypes.WPARAM),
        ("lParam", wintypes.LPARAM),
        ("time", wintypes.DWORD),
        ("pt", POINT),
    ]


def _proto(lib, name, restype, *argtypes):
    # 戻り値・引数の型を明示しないと、64 ビットのハンドルが切り捨てられるため
    fn = getattr(lib, name)
    fn.restype = restype
    fn.argtypes = list(argtypes)
    return fn


FindWindowW = _proto(user32, "FindWindowW", HANDLE, wintypes.LPCWSTR, wintypes.LPCWSTR)
FindWindowExW = _proto(
    user32, "FindWindowExW", HANDLE, HANDLE, HANDLE, wintypes.LPCWSTR, wintypes.LPCWSTR
)
GetWindowRect = _proto(user32, "GetWindowRect", wintypes.BOOL, HANDLE, ctypes.POINTER(RECT))
GetClientRect = _proto(user32, "GetClientRect", wintypes.BOOL, HANDLE, ctypes.POINTER(RECT))
SetWindowPos = _proto(
    user32,
    "SetWindowPos",
    wintypes.BOOL,
    HANDLE,
    HANDLE,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    wintypes.UINT,
)
CreateWindowExW = _proto(
    user32,
    "CreateWindowExW",
    HANDLE,
    wintypes.DWORD,
    wintypes.LPCWSTR,
    wintypes.LPCWSTR,
    wintypes.DWORD,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    HANDLE,
    HANDLE,
    HANDLE,
    HANDLE,
)
IsWindow = _proto(user32, "IsWindow", wintypes.BOOL, HANDLE)
RegisterClassW = _proto(user32, "RegisterClassW", wintypes.ATOM, ctypes.POINTER(WNDCLASSW))
DefWindowProcW = _proto(
    user32, "DefWindowProcW", LRESULT, HANDLE, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
)
GetMessageW = _proto(
    user32, "GetMessageW", wintypes.BOOL, ctypes.POINTER(MSG), HANDLE, wintypes.UINT, wintypes.UINT
)
TranslateMessage = _proto(user32, "TranslateMessage", wintypes.BOOL, ctypes.POINTER(MSG))
DispatchMessageW = _proto(user32, "DispatchMessageW", LRESULT, ctypes.POINTER(MSG))
PostMessageW = _proto(
    user32, "PostMessageW", wintypes.BOOL, HANDLE, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
)
PostQuitMessage = _proto(user32, "PostQuitMessage", None, ctypes.c_int)
BeginPaint = _proto(user32, "BeginPaint", HANDLE, HANDLE, ctypes.POINTER(PAINTSTRUCT))
EndPaint = _proto(user32, "EndPaint", wintypes.BOOL, HANDLE, ctypes.POINTER(PAINTSTRUCT))
FillRect = _proto(user32, "FillRect", ctypes.c_int, HANDLE, ctypes.POINTER(RECT), HANDLE)
DrawTextW = _proto(
    user32, "DrawTextW", ctypes.c_int, HANDLE, wintypes.LPCWSTR, ctypes.c_int, ctypes.POINTER(RECT), wintypes.UINT
)
GetDpiForWindow = _proto(user32, "GetDpiForWindow", wintypes.UINT, HANDLE)
InvalidateRect = _proto(user32, "InvalidateRect", wintypes.BOOL, HANDLE, ctypes.c_void_p, wintypes.BOOL)
CreateSolidBrush = _proto(gdi32, "CreateSolidBrush", HANDLE, wintypes.DWORD)
CreateFontW = _proto(
    gdi32,
    "CreateFontW",
    HANDLE,
    *([ctypes.c_int] * 13),
    wintypes.LPCWSTR,
)
SelectObject = _proto(gdi32, "SelectObject", HANDLE, HANDLE, HANDLE)
SetTextColor = _proto(gdi32, "SetTextColor", wintypes.DWORD, HANDLE, wintypes.DWORD)
SetBkMode = _proto(gdi32, "SetBkMode", ctypes.c_int, HANDLE, ctypes.c_int)
DeleteObject = _proto(gdi32, "DeleteObject", wintypes.BOOL, HANDLE)
SetProcessDpiAwareness = _proto(shcore, "SetProcessDpiAwareness", ctypes.c_long, ctypes.c_int)


def enable_dpi_awareness():
    # 窓を作る前に呼ぶ。呼ばないと座標がスケールされ、通知領域との位置がずれる
    try:
        SetProcessDpiAwareness(PROCESS_PER_MONITOR_DPI_AWARE)
    except OSError:
        pass


def overlay_layout(taskbar_height, tray_left, width):
    # タスクバーの左上を原点とした座標。窓の右端を通知領域の左端に揃える
    x = max(0, tray_left - width)
    return (x, 0, width, taskbar_height)


def cell_items(status):
    # /api/status の totals を、表示用の枠のリストにする。未接続なら None
    if status is None:
        return None
    counting = bool(status.get("counting"))
    target = status.get("target")
    return [
        {
            "label": info["label"],
            "minutes": info["seconds"] // 60,
            "counting": counting and target == key,
        }
        for key, info in status.get("totals", {}).items()
    ]


def _rgb(r, g, b):
    return r | (g << 8) | (b << 16)


def _is_light_theme():
    # タスクバーの配色はシステムのライト/ダーク設定に従う
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
        )
        with key:
            value, _ = winreg.QueryValueEx(key, "SystemUsesLightTheme")
        return bool(value)
    except OSError:
        return True


def _rect_of(hwnd):
    rect = RECT()
    if not GetWindowRect(hwnd, ctypes.byref(rect)):
        raise ctypes.WinError(ctypes.get_last_error())
    return rect


def _find_taskbar():
    taskbar = FindWindowW(TASKBAR_CLASS, None)
    if not taskbar:
        raise OSError("タスクバー（Shell_TrayWnd）が見つからない")
    return taskbar


# WNDPROC から現在のオーバーレイを参照するためのグローバル
_app = None
_class_registered = False


def _handle(hwnd, msg, wparam, lparam):
    if _app is not None:
        result = _app.handle(hwnd, msg)
        if result is not None:
            return result
    return DefWindowProcW(hwnd, msg, wparam, lparam)


_WNDPROC_CB = WNDPROC(_handle)


def _register_class():
    global _class_registered
    if _class_registered:
        return
    wc = WNDCLASSW()
    wc.lpfnWndProc = _WNDPROC_CB
    wc.lpszClassName = CLASS_NAME
    if not RegisterClassW(ctypes.byref(wc)):
        raise ctypes.WinError(ctypes.get_last_error())
    _class_registered = True


_ERROR_LOG = os.path.join(tempfile.gettempdir(), "apptime_overlay.log")


def _log_error(exc):
    # pythonw では標準エラーが見えないため、描画失敗の理由をファイルに残す
    with open(_ERROR_LOG, "a", encoding="utf-8") as f:
        f.write(f"{datetime.now().isoformat(timespec='seconds')} {exc!r}\n")


class Overlay:
    def __init__(self, on_click, cell_width=110):
        global _app
        self.on_click = on_click
        self.cell_width = cell_width  # 論理ピクセル（100% 基準）
        self.cells = None  # None は未接続
        self.overlay_hwnd = None
        _register_class()
        # 非表示のメッセージ専用窓。別スレッドからの更新通知と終了をここで受ける。
        # タスクバーが再起動されても、この窓は消えない
        self.host = CreateWindowExW(
            0, CLASS_NAME, "apptime-host", 0, 0, 0, 0, 0,
            HANDLE(HWND_MESSAGE), None, None, None,
        )
        if not self.host:
            raise ctypes.WinError(ctypes.get_last_error())
        _app = self

    def set_status(self, status):
        # 別スレッド（ポーリング）から呼ばれる。描画は主スレッドで行う
        self.cells = cell_items(status)
        PostMessageW(self.host, MSG_REFRESH, 0, 0)

    def stop(self):
        PostMessageW(self.host, MSG_STOP, 0, 0)

    def run(self):
        self._refresh()
        msg = MSG()
        while GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            TranslateMessage(ctypes.byref(msg))
            DispatchMessageW(ctypes.byref(msg))

    def handle(self, hwnd, msg):
        # None を返すと DefWindowProc に任せる
        if hwnd == self.host:
            if msg == MSG_REFRESH:
                self._refresh()
                return 0
            if msg == MSG_STOP:
                PostQuitMessage(0)
                return 0
            return None
        if hwnd == self.overlay_hwnd:
            if msg == WM_PAINT:
                self._paint(hwnd)
                return 0
            if msg == WM_LBUTTONUP:
                self.on_click()
                return 0
        return None

    def _refresh(self):
        try:
            if self.overlay_hwnd is None or not IsWindow(self.overlay_hwnd):
                self._create()
            self._place()
            InvalidateRect(self.overlay_hwnd, None, True)
        except OSError as exc:
            # タスクバーが無い（Explorer 再起動中など）時は表示を飛ばす。次の更新で再試行する
            _log_error(exc)
            self.overlay_hwnd = None

    def _create(self):
        taskbar = _find_taskbar()
        hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            CLASS_NAME, "アプリ時間", WS_POPUP, 0, 0, 1, 1,
            None, None, None, None,
        )
        if not hwnd:
            raise ctypes.WinError(ctypes.get_last_error())
        self.overlay_hwnd = hwnd

    def _place(self):
        taskbar = _find_taskbar()
        tray = FindWindowExW(taskbar, None, TRAY_NOTIFY_CLASS, None)
        if not tray:
            raise OSError("通知領域（TrayNotifyWnd）が見つからない")
        tb = _rect_of(taskbar)
        tn = _rect_of(tray)
        dpi = GetDpiForWindow(taskbar) or 96
        width = round(self.cell_width * 2 * dpi / 96)
        x, y, w, h = overlay_layout(tb.bottom - tb.top, tn.left - tb.left, width)
        # 窓は画面座標で置く（タスクバーの左上を足して戻す）
        SetWindowPos(
            self.overlay_hwnd, HWND_TOPMOST,
            tb.left + x, tb.top + y, w, h,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )

    def _paint(self, hwnd):
        ps = PAINTSTRUCT()
        hdc = BeginPaint(hwnd, ctypes.byref(ps))
        rc = RECT()
        GetClientRect(hwnd, ctypes.byref(rc))

        light = _is_light_theme()
        bg = _rgb(243, 243, 243) if light else _rgb(32, 32, 32)
        fg = _rgb(0, 0, 0) if light else _rgb(255, 255, 255)
        green = _rgb(26, 127, 55) if light else _rgb(110, 210, 140)

        dpi = GetDpiForWindow(hwnd) or 96
        # 9pt をピクセル高さに換算（-値は文字の高さ指定）
        font = CreateFontW(
            -round(9 * dpi / 72), 0, 0, 0, FW_NORMAL, 0, 0, 0,
            DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0,
            "Yu Gothic UI",
        )
        old_font = SelectObject(hdc, font)
        brush = CreateSolidBrush(bg)
        FillRect(hdc, ctypes.byref(rc), brush)
        DeleteObject(brush)
        SetBkMode(hdc, TRANSPARENT)

        flags = DT_CENTER | DT_VCENTER | DT_SINGLELINE
        items = self.cells
        if not items:
            SetTextColor(hdc, fg)
            text = "アプリ時間: 未接続" if items is None else "対象なし"
            DrawTextW(hdc, text, -1, ctypes.byref(rc), flags)
        else:
            cell_w = (rc.right - rc.left) // len(items)
            for i, item in enumerate(items):
                cell = RECT(i * cell_w, rc.top, (i + 1) * cell_w, rc.bottom)
                SetTextColor(hdc, green if item["counting"] else fg)
                text = f"{item['label']} {item['minutes']}分"
                DrawTextW(hdc, text, -1, ctypes.byref(cell), flags)

        SelectObject(hdc, old_font)
        DeleteObject(font)
        EndPaint(hwnd, ctypes.byref(ps))
