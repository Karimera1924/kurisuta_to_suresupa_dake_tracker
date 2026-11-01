import os
import tempfile
import unittest
from unittest import mock

import overlay
from overlay import (
    SENTINEL_RGB,
    _dib_rgb,
    _rgb,
    cell_items,
    is_cover_fullscreen,
    log_error,
    overlay_layout,
    overlay_visible,
    to_argb,
)

MONITOR = (0, 0, 3840, 2160)


class ToArgbTest(unittest.TestCase):
    def test_番兵色は完全に透明になる(self):
        self.assertEqual(to_argb([SENTINEL_RGB], SENTINEL_RGB, 0x202020, 210), [0])

    def test_背面色は指定の不透明度で乗算済みの色になる(self):
        pill = _dib_rgb(_rgb(40, 40, 40))
        # 40 * 210 / 255 = 32（整数除算）
        self.assertEqual(
            to_argb([pill], SENTINEL_RGB, pill, 210),
            [(210 << 24) | (32 << 16) | (32 << 8) | 32],
        )

    def test_文字などのそれ以外は不透明になる(self):
        self.assertEqual(to_argb([0x00FFFFFF], SENTINEL_RGB, 0x202020, 210), [0xFFFFFFFF])


class DibRgbTest(unittest.TestCase):
    def test_COLORREFからDIBへR_Bを入れ替える(self):
        self.assertEqual(_dib_rgb(_rgb(10, 20, 30)), 0x0A141E)


class OverlayLayoutTest(unittest.TestCase):
    def test_窓の右端が通知領域の左端に揃う(self):
        # 150% スケールの実測値: 通知領域の左端 3216、窓の幅 330 → 左端 2886 で、右端は 3216
        x, y, w, h = overlay_layout(taskbar_height=72, tray_left=3216, width=330)
        self.assertEqual((x, y, w, h), (2886, 0, 330, 72))
        self.assertEqual(x + w, 3216)

    def test_高さはタスクバーに収まる(self):
        _, y, _, h = overlay_layout(taskbar_height=72, tray_left=3216, width=330)
        self.assertEqual(y, 0)
        self.assertEqual(h, 72)

    def test_幅が足りない時は左端を0で止める(self):
        x, _, _, _ = overlay_layout(taskbar_height=72, tray_left=100, width=330)
        self.assertEqual(x, 0)


class CoverFullscreenTest(unittest.TestCase):
    def test_モニタ全体を覆う窓は全画面扱い(self):
        self.assertTrue(is_cover_fullscreen("SlayTheSpire", MONITOR, MONITOR))

    def test_タスクバーを残した最大化は全画面扱いしない(self):
        self.assertFalse(is_cover_fullscreen("Chrome", (0, 0, 3840, 2088), MONITOR))

    def test_デスクトップの殻は全画面扱いしない(self):
        self.assertFalse(is_cover_fullscreen("Progman", MONITOR, MONITOR))
        self.assertFalse(is_cover_fullscreen("WorkerW", MONITOR, MONITOR))

    def test_窓がずれていれば全画面扱いしない(self):
        self.assertFalse(is_cover_fullscreen("Chrome", (100, 0, 3940, 2160), MONITOR))


class OverlayVisibleTest(unittest.TestCase):
    def test_通常時は表示する(self):
        self.assertTrue(overlay_visible(False, False))

    def test_タスクバーの自動非表示なら隠す(self):
        self.assertFalse(overlay_visible(False, True))

    def test_前面の窓に覆われていたら隠す(self):
        self.assertFalse(overlay_visible(True, False))

    def test_覆われていて自動非表示でも隠す(self):
        self.assertFalse(overlay_visible(True, True))


class LogErrorTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.path = os.path.join(self._dir.name, "overlay.log")
        # 直前の失敗の記録を別テストと混ぜない
        patcher = mock.patch.object(overlay, "_ERROR_LOG", self.path)
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = mock.patch.object(overlay, "_last_error", None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def read_lines(self):
        with open(self.path, encoding="utf-8") as f:
            return f.read().splitlines()

    def test_同じ失敗が続けて来ても1行だけ書く(self):
        log_error(OSError("描画に失敗"))
        log_error(OSError("描画に失敗"))
        self.assertEqual(len(self.read_lines()), 1)

    def test_違う失敗は書き足す(self):
        log_error(OSError("一つ目"))
        log_error(OSError("二つ目"))
        self.assertEqual(len(self.read_lines()), 2)

    def test_上限を超えたログは作り直す(self):
        with mock.patch.object(overlay, "_ERROR_LOG_MAX", 10):
            with open(self.path, "w", encoding="utf-8") as f:
                f.write("古い記録\n" * 5)
            log_error(ValueError("新しい"))
        lines = self.read_lines()
        self.assertEqual(len(lines), 1)
        self.assertIn("新しい", lines[0])


class CellItemsTest(unittest.TestCase):
    def test_未接続はNone(self):
        self.assertIsNone(cell_items(None))

    def test_計測中の対象だけ緑扱いにする(self):
        status = {
            "counting": True,
            "target": "clipstudiopaint",
            "pinned": [
                {"key": "clipstudiopaint", "label": "ClipStudioPaint", "seconds": 725},
                {"key": "slaythespire", "label": "SlayTheSpire", "seconds": 59},
            ],
        }
        self.assertEqual(
            cell_items(status),
            [
                {"label": "ClipStudioPaint", "minutes": 12, "counting": True},
                {"label": "SlayTheSpire", "minutes": 0, "counting": False},
            ],
        )

    def test_待機中は全部計測中でない(self):
        status = {
            "counting": False,
            "target": None,
            "pinned": [{"key": "clipstudiopaint", "label": "ClipStudioPaint", "seconds": 0}],
        }
        self.assertEqual(
            cell_items(status),
            [{"label": "ClipStudioPaint", "minutes": 0, "counting": False}],
        )

    def test_ピンが無ければ空のリスト(self):
        self.assertEqual(cell_items({"counting": False, "pinned": []}), [])

if __name__ == "__main__":
    unittest.main()
