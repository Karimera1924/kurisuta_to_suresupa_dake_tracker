"""アプリ時間トラッカーのタスクバー常駐アイコンと、タスクバーのオーバーレイ。

/api/status を 5 秒おきに取得して、以下を更新する。
- タスクバーのオーバーレイ（通知領域のすぐ左に、クリスタとスレスパの今日の合計）
- トレイアイコンのツールチップ（マウスを載せた時の文字）

トレイのメニューは「WebUI を開く」「終了」。オーバーレイのクリックでも WebUI を開く。
トラッカーに接続できない時は「未接続」と表示する。

起動: pythonw tray/tray.py
"""

import json
import os
import threading
import urllib.request
import webbrowser

import pystray
from PIL import Image, ImageDraw

from overlay import Overlay, enable_dpi_awareness

POLL_SECONDS = 5
HOST = "127.0.0.1"
PORT = int(os.environ.get("APPTIME_PORT", "17600"))
BASE_URL = f"http://{HOST}:{PORT}"
TOOLTIP_MAX = 127  # Windows のツールチップの上限文字数

COLOR_COUNTING = (26, 127, 55)
COLOR_IDLE = (119, 119, 119)
COLOR_OFFLINE = (180, 35, 24)


def fetch_status(timeout=2):
    # 接続できない・応答がおかしい場合は None を返す（未接続扱い）
    try:
        with urllib.request.urlopen(f"{BASE_URL}/api/status", timeout=timeout) as res:
            return json.load(res)
    except Exception:
        return None


def build_tooltip(status):
    if status is None:
        return "アプリ時間: 未接続"

    if status.get("counting"):
        target = status.get("target")
        label = status["totals"].get(target, {}).get("label", target)
        head = f"計測中: {label}"
    else:
        head = "待機中"

    parts = [
        f"{info['label']} {info['seconds'] // 60}分"
        for info in status.get("totals", {}).values()
    ]
    text = "アプリ時間 " + head + " | " + " / ".join(parts)
    return text[:TOOLTIP_MAX]


def make_icon_image(color):
    # 角丸の四角。状態ごとに色を変える（計測中: 緑 / 待機中: 灰 / 未接続: 赤）
    size = 64
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((4, 4, size - 4, size - 4), radius=12, fill=color)
    return image


def icon_color(status):
    if status is None:
        return COLOR_OFFLINE
    return COLOR_COUNTING if status.get("counting") else COLOR_IDLE


def poll(icon, overlay, stop_event):
    # 取得 → 表示更新 を POLL_SECONDS おきに繰り返す。stop されたら終わる
    while not stop_event.is_set():
        status = fetch_status()
        icon.icon = make_icon_image(icon_color(status))
        icon.title = build_tooltip(status)
        overlay.set_status(status)
        stop_event.wait(POLL_SECONDS)


def open_webui_url():
    webbrowser.open(BASE_URL + "/")


def open_webui(icon, item):
    open_webui_url()


def main():
    # オーバーレイの窓は主スレッドのメッセージループで回し、トレイは別スレッドで動かす
    enable_dpi_awareness()
    stop_event = threading.Event()
    overlay = Overlay(on_click=open_webui_url)

    def quit_app(icon, item):
        stop_event.set()
        icon.stop()
        overlay.stop()

    icon = pystray.Icon(
        "apptime",
        make_icon_image(COLOR_OFFLINE),
        build_tooltip(None),
        menu=pystray.Menu(
            pystray.MenuItem("WebUI を開く", open_webui, default=True),
            pystray.MenuItem("終了", quit_app),
        ),
    )

    def setup(icon):
        icon.visible = True
        threading.Thread(
            target=poll, args=(icon, overlay, stop_event), daemon=True
        ).start()

    icon.run_detached(setup)
    try:
        overlay.run()
    finally:
        stop_event.set()
        icon.stop()


if __name__ == "__main__":
    main()
