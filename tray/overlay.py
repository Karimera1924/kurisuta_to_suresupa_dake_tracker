"""タスクバー右側（通知領域のすぐ左）に、対象ごとの今日の合計を出すオーバーレイ。

タスクバーの上に重ねる最前面の窓（子ウィンドウにはしない）。
子ウィンドウだとタスクバーの描画層の裏に回るため。
窓の右端を通知領域（TrayNotifyWnd）の左端に揃え、高さはタスクバーに合わせる。
Windows のウィジェット機能とは別物。

見た目は、対象ごとの角丸の半透明な枠（ピル型）だけを描く。
それ以外の部分は完全に透明にして、背景のタスクバーをそのまま見せる。
（レイヤー窓 + UpdateLayeredWindow で、ピクセル単位の α を付ける）
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
shell32 = ctypes.WinDLL("shell32", use_last_error=True)

HANDLE = ctypes.c_void_p
LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(
    LRESULT, HANDLE, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
)
WINEVENTPROC = ctypes.WINFUNCTYPE(
    None,
    HANDLE,
    wintypes.DWORD,
    HANDLE,
    wintypes.LONG,
    wintypes.LONG,
    wintypes.DWORD,
    wintypes.DWORD,
)

WS_POPUP = 0x80000000
WS_EX_TOPMOST = 0x00000008
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_LAYERED = 0x00080000
WS_EX_NOACTIVATE = 0x08000000
HWND_TOPMOST = -1
HWND_MESSAGE = -3
SWP_NOACTIVATE = 0x0010
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_SHOWWINDOW = 0x0040
WM_LBUTTONUP = 0x0202
WM_APP = 0x8000
MSG_REFRESH = WM_APP + 1
MSG_STOP = WM_APP + 2
MSG_CHECK = WM_APP + 3
WM_TIMER = 0x0113
# 表示の要否は主にイベントで見直す。タイマーは自動非表示（イベントが無い）と取りこぼしの保険（ミリ秒）
RECHECK_TIMER_ID = 1
RECHECK_MS = 1000
DT_CENTER = 0x01
DT_VCENTER = 0x04
DT_SINGLELINE = 0x20
DT_NOPREFIX = 0x800
DT_END_ELLIPSIS = 0x8000
TRANSPARENT = 1
FW_NORMAL = 400
DEFAULT_CHARSET = 1
ANTIALIASED_QUALITY = 4
DIB_RGB_COLORS = 0
BI_RGB = 0
NULL_PEN = 8
AC_SRC_OVER = 0
AC_SRC_ALPHA = 1
ULW_ALPHA = 0x00000002
CLASS_NAME = "AppTimeOverlay"
TASKBAR_CLASS = "Shell_TrayWnd"
TRAY_NOTIFY_CLASS = "TrayNotifyWnd"
PROCESS_PER_MONITOR_DPI_AWARE = 2
SW_HIDE = 0
EVENT_SYSTEM_FOREGROUND = 0x0003
EVENT_OBJECT_LOCATIONCHANGE = 0x800B
OBJID_WINDOW = 0
WINEVENT_OUTOFCONTEXT = 0x0000
MONITOR_DEFAULTTONEAREST = 0x00000002
ABM_GETSTATE = 0x00000004
ABS_AUTOHIDE = 0x00000001
# デスクトップ等は画面いっぱいの窓なので、全画面扱いから外す
SHELL_CLASSES = ("Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd")

# ピルの背面色（α を付けた時の不透明度）。透明にする部分は番兵色で描いてから α=0 にする
PILL_ALPHA = 210
SENTINEL_RGB = 0xFF00FF  # DIB 形式（0x00RRGGBB）の番兵色（マゼンタ）
PILL_MARGIN = 4  # 論理ピクセル（100% 基準）。タスクバーの上下と、枠同士の隙間


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]


class POINT(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]


class SIZE(ctypes.Structure):
    _fields_ = [("cx", wintypes.LONG), ("cy", wintypes.LONG)]


class BLENDFUNCTION(ctypes.Structure):
    _fields_ = [
        ("BlendOp", ctypes.c_ubyte),
        ("BlendFlags", ctypes.c_ubyte),
        ("SourceConstantAlpha", ctypes.c_ubyte),
        ("AlphaFormat", ctypes.c_ubyte),
    ]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD),
        ("biWidth", wintypes.LONG),
        ("biHeight", wintypes.LONG),
        ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD),
        ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD),
        ("biXPelsPerMeter", wintypes.LONG),
        ("biYPelsPerMeter", wintypes.LONG),
        ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wintypes.DWORD * 1)]


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


class MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("rcMonitor", RECT),
        ("rcWork", RECT),
        ("dwFlags", wintypes.DWORD),
    ]


class APPBARDATA(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("hWnd", HANDLE),
        ("uCallbackMessage", wintypes.UINT),
        ("uEdge", wintypes.UINT),
        ("rc", RECT),
        ("lParam", wintypes.LPARAM),
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
# 第 2 引数は MAKEINTRESOURCE(IDC_ARROW) = 32512。整数をそのまま渡すため HANDLE で受ける
LoadCursorW = _proto(user32, "LoadCursorW", HANDLE, HANDLE, HANDLE)
IDC_ARROW = 32512
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
GetDC = _proto(user32, "GetDC", HANDLE, HANDLE)
ReleaseDC = _proto(user32, "ReleaseDC", ctypes.c_int, HANDLE, HANDLE)
FillRect = _proto(user32, "FillRect", ctypes.c_int, HANDLE, ctypes.POINTER(RECT), HANDLE)
DrawTextW = _proto(
    user32, "DrawTextW", ctypes.c_int, HANDLE, wintypes.LPCWSTR, ctypes.c_int, ctypes.POINTER(RECT), wintypes.UINT
)
GetDpiForWindow = _proto(user32, "GetDpiForWindow", wintypes.UINT, HANDLE)
GetForegroundWindow = _proto(user32, "GetForegroundWindow", HANDLE)
GetClassNameW = _proto(user32, "GetClassNameW", ctypes.c_int, HANDLE, wintypes.LPWSTR, ctypes.c_int)
MonitorFromWindow = _proto(user32, "MonitorFromWindow", HANDLE, HANDLE, wintypes.DWORD)
GetMonitorInfoW = _proto(user32, "GetMonitorInfoW", wintypes.BOOL, HANDLE, ctypes.POINTER(MONITORINFO))
ShowWindow = _proto(user32, "ShowWindow", wintypes.BOOL, HANDLE, ctypes.c_int)
SetWinEventHook = _proto(
    user32,
    "SetWinEventHook",
    HANDLE,
    wintypes.DWORD,
    wintypes.DWORD,
    HANDLE,
    WINEVENTPROC,
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.DWORD,
)
UnhookWinEvent = _proto(user32, "UnhookWinEvent", wintypes.BOOL, HANDLE)
SetTimer = _proto(
    user32, "SetTimer", ctypes.c_size_t, HANDLE, ctypes.c_size_t, wintypes.UINT, HANDLE
)
KillTimer = _proto(user32, "KillTimer", wintypes.BOOL, HANDLE, ctypes.c_size_t)
DestroyWindow = _proto(user32, "DestroyWindow", wintypes.BOOL, HANDLE)
SHAppBarMessage = _proto(
    shell32, "SHAppBarMessage", ctypes.c_size_t, wintypes.DWORD, ctypes.POINTER(APPBARDATA)
)
UpdateLayeredWindow = _proto(
    user32,
    "UpdateLayeredWindow",
    wintypes.BOOL,
    HANDLE,
    HANDLE,
    ctypes.POINTER(POINT),
    ctypes.POINTER(SIZE),
    HANDLE,
    ctypes.POINTER(POINT),
    wintypes.DWORD,
    ctypes.POINTER(BLENDFUNCTION),
    wintypes.DWORD,
)
CreateCompatibleDC = _proto(gdi32, "CreateCompatibleDC", HANDLE, HANDLE)
DeleteDC = _proto(gdi32, "DeleteDC", wintypes.BOOL, HANDLE)
CreateDIBSection = _proto(
    gdi32,
    "CreateDIBSection",
    HANDLE,
    HANDLE,
    ctypes.POINTER(BITMAPINFO),
    wintypes.UINT,
    ctypes.POINTER(ctypes.c_void_p),
    HANDLE,
    wintypes.DWORD,
)
CreateSolidBrush = _proto(gdi32, "CreateSolidBrush", HANDLE, wintypes.DWORD)
GetStockObject = _proto(gdi32, "GetStockObject", HANDLE, ctypes.c_int)
RoundRect = _proto(
    gdi32,
    "RoundRect",
    wintypes.BOOL,
    HANDLE,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
)
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


def is_cover_fullscreen(class_name, window, monitor):
    # 前面の窓が、モニタ全体（rcMonitor）を覆っているか。デスクトップ等の殻の窓は除く
    if class_name in SHELL_CLASSES:
        return False
    return (
        window[0] <= monitor[0]
        and window[1] <= monitor[1]
        and window[2] >= monitor[2]
        and window[3] >= monitor[3]
    )


def overlay_visible(covered_by_window, autohide):
    # 表示するかどうか。自動的に隠れるタスクバー、またはタスクバーのあるモニタを前面の窓が覆う時は隠す
    # SHQueryUserNotificationState は全モニタ共通の値なので、他のモニタの全画面で隠れないよう使わない
    if autohide:
        return False
    return not covered_by_window


def cell_items(status):
    # /api/status の pinned（タスクバーに出すアプリ）を、表示用の枠のリストにする。未接続なら None
    if status is None:
        return None
    counting = bool(status.get("counting"))
    target = status.get("target")
    return [
        {
            "label": info["label"],
            "minutes": info["seconds"] // 60,
            "counting": counting and target == info["key"],
        }
        for info in status.get("pinned", [])
    ]


def _rgb(r, g, b):
    # COLORREF（0x00BBGGRR）の形で返す。CreateSolidBrush や SetTextColor に渡す値
    return r | (g << 8) | (b << 16)


def _dib_rgb(colorref):
    # DIB のピクセル値（0x00RRGGBB）に直す。COLORREF とは R と B の位置が逆
    r = colorref & 0xFF
    g = (colorref >> 8) & 0xFF
    b = (colorref >> 16) & 0xFF
    return (r << 16) | (g << 8) | b


def to_argb(pixels, sentinel, pill, pill_alpha):
    # 描いたピクセルを、UpdateLayeredWindow 用の 0xAARRGGBB（色は α で乗算済み）に変換する
    #   番兵色 → 完全に透明
    #   ピルの背面色 → pill_alpha の半透明
    #   それ以外（文字）→ 不透明
    pr = (pill >> 16) & 0xFF
    pg = (pill >> 8) & 0xFF
    pb = pill & 0xFF
    premul = (
        ((pr * pill_alpha // 255) << 16)
        | ((pg * pill_alpha // 255) << 8)
        | (pb * pill_alpha // 255)
    )
    pill_argb = (pill_alpha << 24) | premul
    out = []
    for v in pixels:
        rgb = v & 0xFFFFFF
        if rgb == sentinel:
            out.append(0)
        elif rgb == pill:
            out.append(pill_argb)
        else:
            out.append(0xFF000000 | rgb)
    return out


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


def _taskbar_monitor_covered():
    # タスクバーのあるモニタ全体を、前面の窓が覆っているか
    # 他のモニタの全画面は見ない（SHQueryUserNotificationState は全モニタ共通のため使わない）
    taskbar = _find_taskbar()
    monitor = MonitorFromWindow(taskbar, MONITOR_DEFAULTTONEAREST)
    if not monitor:
        raise OSError("タスクバーのモニタが取れない")
    info = MONITORINFO()
    info.cbSize = ctypes.sizeof(MONITORINFO)
    if not GetMonitorInfoW(monitor, ctypes.byref(info)):
        raise ctypes.WinError(ctypes.get_last_error())
    mon = info.rcMonitor
    try:
        hwnd = GetForegroundWindow()
        if not hwnd:
            return False
        buf = ctypes.create_unicode_buffer(256)
        GetClassNameW(hwnd, buf, len(buf))
        window = _rect_of(hwnd)
    except OSError:
        # 前面の窓が取れない時は覆われていない扱いにする
        return False
    return is_cover_fullscreen(
        buf.value,
        (window.left, window.top, window.right, window.bottom),
        (mon.left, mon.top, mon.right, mon.bottom),
    )


def _taskbar_autohide():
    # タスクバーが自動的に隠れる設定か
    data = APPBARDATA()
    data.cbSize = ctypes.sizeof(APPBARDATA)
    state = SHAppBarMessage(ABM_GETSTATE, ctypes.byref(data))
    return bool(state & ABS_AUTOHIDE)


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
    # カーソルを指定しないと、窓の上で直前のカーソル（起動中の砂時計など）が残るため矢印を指定する
    wc.hCursor = LoadCursorW(None, IDC_ARROW)
    if not RegisterClassW(ctypes.byref(wc)):
        raise ctypes.WinError(ctypes.get_last_error())
    _class_registered = True


_ERROR_LOG = os.path.join(tempfile.gettempdir(), "apptime_overlay.log")
_ERROR_LOG_MAX = 1024 * 1024  # バイト。これを超えたら作り直す
_last_error = None


def log_error(exc):
    # pythonw では標準エラーが見えないため、失敗の理由をファイルに残す
    # 直前と同じ失敗は書かない（300 ms ごとの再確認で同じ行が溜まるのを防ぐ）
    global _last_error
    detail = repr(exc)
    if detail == _last_error:
        return
    _last_error = detail
    try:
        mode = "a"
        if os.path.exists(_ERROR_LOG) and os.path.getsize(_ERROR_LOG) > _ERROR_LOG_MAX:
            mode = "w"
        with open(_ERROR_LOG, mode, encoding="utf-8") as f:
            f.write(f"{datetime.now().isoformat(timespec='seconds')} {detail}\n")
    except OSError:
        # ログが書けない時に、表示の処理まで止めない
        pass


class Overlay:
    def __init__(self, on_click, cell_width=110):
        global _app
        self.on_click = on_click
        self.cell_width = cell_width  # 論理ピクセル（100% 基準）
        self.cells = None  # None は未接続
        self.overlay_hwnd = None
        self._hooks = []
        self._hook_proc = None  # ctypes のコールバックは参照を持ち続けないと回収される
        self._shown = False  # 表示中か（表示中の再確認では再描画を省く）
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
        try:
            self._install_hooks()
            if not SetTimer(self.host, RECHECK_TIMER_ID, RECHECK_MS, None):
                log_error(ctypes.WinError(ctypes.get_last_error()))
            self._refresh()
            msg = MSG()
            while GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                TranslateMessage(ctypes.byref(msg))
                DispatchMessageW(ctypes.byref(msg))
        finally:
            self._teardown()

    def _teardown(self):
        # 終了時に、フック・タイマー・窓を確実に片付ける（途中で例外が出ても残さない）
        for hook in self._hooks:
            UnhookWinEvent(hook)
        self._hooks = []
        KillTimer(self.host, RECHECK_TIMER_ID)
        self._discard()
        DestroyWindow(self.host)

    def _install_hooks(self):
        # 前面の切り替え（EVENT_SYSTEM_FOREGROUND）と、前面の窓の移動・リサイズ（LOCATIONCHANGE）で
        # 表示の要否を即座に見直す。コールバックは主スレッドのメッセージループで呼ばれる
        self._hook_proc = WINEVENTPROC(self._on_event)
        for event in (EVENT_SYSTEM_FOREGROUND, EVENT_OBJECT_LOCATIONCHANGE):
            hook = SetWinEventHook(
                event, event, None, self._hook_proc, 0, 0, WINEVENT_OUTOFCONTEXT,
            )
            if hook:
                self._hooks.append(hook)
            else:
                log_error(ctypes.WinError(ctypes.get_last_error()))

    def _on_event(self, hook, event, hwnd, id_object, id_child, thread, time):
        if event == EVENT_SYSTEM_FOREGROUND:
            PostMessageW(self.host, MSG_REFRESH, 0, 0)
        elif id_object == OBJID_WINDOW and hwnd and hwnd == GetForegroundWindow():
            # 他の窓の動きでは再判定しない（前面の窓だけ見る）
            PostMessageW(self.host, MSG_CHECK, 0, 0)

    def handle(self, hwnd, msg):
        # None を返すと DefWindowProc に任せる
        if hwnd == self.host:
            if msg == MSG_REFRESH:
                self._refresh()
                return 0
            if msg in (WM_TIMER, MSG_CHECK):
                # 表示の要否だけ見直す。表示中なら描画は変えない
                self._refresh(repaint=False)
                return 0
            if msg == MSG_STOP:
                PostQuitMessage(0)
                return 0
            return None
        if hwnd == self.overlay_hwnd and msg == WM_LBUTTONUP:
            self.on_click()
            return 0
        return None

    def _refresh(self, repaint=True):
        try:
            if self.overlay_hwnd is None or not IsWindow(self.overlay_hwnd):
                self._create()
                self._shown = False
            if not overlay_visible(_taskbar_monitor_covered(), _taskbar_autohide()):
                # 全画面・自動的に隠れるタスクバーの時は隠す（SetWindowPos で再表示されないよう先に返す）
                if self._shown:
                    ShowWindow(self.overlay_hwnd, SW_HIDE)
                self._shown = False
                return
            if repaint or not self._shown:
                self._place()
                self._paint(self.overlay_hwnd)
            else:
                # 表示中の再確認では描画を変えず、最前面だけ取り直す（他の窓に前面を取られた時の対策）
                SetWindowPos(
                    self.overlay_hwnd, HWND_TOPMOST, 0, 0, 0, 0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                )
            self._shown = True
        except Exception as exc:
            # タスクバーが無い（Explorer 再起動中など）時は表示を飛ばす。窓は壊して次の更新で作り直す
            log_error(exc)
            self._discard()

    def _discard(self):
        if self.overlay_hwnd is not None:
            DestroyWindow(self.overlay_hwnd)
        self.overlay_hwnd = None
        self._shown = False

    def _create(self):
        _find_taskbar()
        hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED,
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
        rc = RECT()
        GetClientRect(hwnd, ctypes.byref(rc))
        w = rc.right - rc.left
        h = rc.bottom - rc.top
        # 描画の途中で set_status により値が変わっても、この描画の中では同じ値を使う
        cells = self.cells

        light = _is_light_theme()
        pill = _rgb(255, 255, 255) if light else _rgb(40, 40, 40)
        fg = _rgb(0, 0, 0) if light else _rgb(255, 255, 255)
        green = _rgb(26, 127, 55) if light else _rgb(110, 210, 140)

        dpi = GetDpiForWindow(hwnd) or 96
        margin = round(PILL_MARGIN * dpi / 96)

        if cells:
            cell_w = w // len(cells)
            slots = [RECT(i * cell_w, 0, (i + 1) * cell_w, h) for i in range(len(cells))]
            entries = [
                (f"{item['label']} {item['minutes']}分", green if item["counting"] else fg)
                for item in cells
            ]
        else:
            slots = [RECT(0, 0, w, h)]
            text = "アプリ時間: 未接続" if cells is None else "対象なし"
            entries = [(text, fg)]

        # GDI の確保に失敗しても、確保できたものだけを後始末する
        screen_dc = GetDC(None)
        if not screen_dc:
            raise ctypes.WinError(ctypes.get_last_error())
        mem_dc = dib = font = None
        old_bmp = old_font = None
        try:
            mem_dc = CreateCompatibleDC(screen_dc)
            if not mem_dc:
                raise ctypes.WinError(ctypes.get_last_error())
            info = BITMAPINFO()
            info.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
            info.bmiHeader.biWidth = w
            info.bmiHeader.biHeight = -h  # 負の値で上から下へ並べる
            info.bmiHeader.biPlanes = 1
            info.bmiHeader.biBitCount = 32
            info.bmiHeader.biCompression = BI_RGB
            bits = ctypes.c_void_p()
            dib = CreateDIBSection(
                mem_dc, ctypes.byref(info), DIB_RGB_COLORS, ctypes.byref(bits), None, 0
            )
            if not dib:
                raise ctypes.WinError(ctypes.get_last_error())
            old_bmp = SelectObject(mem_dc, dib)

            # 9pt をピクセル高さに換算（-値は文字の高さ指定）
            font = CreateFontW(
                -round(9 * dpi / 72), 0, 0, 0, FW_NORMAL, 0, 0, 0,
                DEFAULT_CHARSET, 0, 0, ANTIALIASED_QUALITY, 0,
                "Yu Gothic UI",
            )
            if not font:
                raise OSError("フォントが作れない")
            old_font = SelectObject(mem_dc, font)

            # 透明にする部分を番兵色で塗る（後で α=0 にする）
            sentinel = CreateSolidBrush(_rgb(255, 0, 255))
            FillRect(mem_dc, ctypes.byref(rc), sentinel)
            DeleteObject(sentinel)
            SetBkMode(mem_dc, TRANSPARENT)

            flags = DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS
            for slot, (text, color) in zip(slots, entries):
                # 枠は角丸のピル型。高さいっぱいの半径にする
                box = RECT(
                    slot.left + margin,
                    slot.top + margin,
                    slot.right - margin,
                    slot.bottom - margin,
                )
                radius = box.bottom - box.top
                brush = CreateSolidBrush(pill)
                old_brush = SelectObject(mem_dc, brush)
                old_pen = SelectObject(mem_dc, GetStockObject(NULL_PEN))
                RoundRect(mem_dc, box.left, box.top, box.right, box.bottom, radius, radius)
                SelectObject(mem_dc, old_pen)
                SelectObject(mem_dc, old_brush)
                DeleteObject(brush)

                SetTextColor(mem_dc, color)
                DrawTextW(mem_dc, text, -1, ctypes.byref(box), flags)

            pixels = (ctypes.c_uint32 * (w * h)).from_address(bits.value)
            pixels[:] = to_argb(list(pixels), SENTINEL_RGB, _dib_rgb(pill), PILL_ALPHA)

            size = SIZE(w, h)
            src = POINT(0, 0)
            blend = BLENDFUNCTION(AC_SRC_OVER, 0, 255, AC_SRC_ALPHA)
            ok = UpdateLayeredWindow(
                hwnd, screen_dc, None, ctypes.byref(size),
                mem_dc, ctypes.byref(src), 0, ctypes.byref(blend), ULW_ALPHA,
            )
            if not ok:
                raise ctypes.WinError(ctypes.get_last_error())
        finally:
            if old_font is not None:
                SelectObject(mem_dc, old_font)
            if old_bmp is not None:
                SelectObject(mem_dc, old_bmp)
            if font:
                DeleteObject(font)
            if dib:
                DeleteObject(dib)
            if mem_dc:
                DeleteDC(mem_dc)
            ReleaseDC(None, screen_dc)
