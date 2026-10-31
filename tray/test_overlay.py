import unittest

from overlay import cell_items, overlay_layout


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


class CellItemsTest(unittest.TestCase):
    def test_未接続はNone(self):
        self.assertIsNone(cell_items(None))

    def test_計測中の対象だけ緑扱いにする(self):
        status = {
            "counting": True,
            "target": "clipstudio",
            "totals": {
                "clipstudio": {"label": "クリスタ", "seconds": 725},
                "slaythespire": {"label": "スレスパ", "seconds": 59},
            },
        }
        self.assertEqual(
            cell_items(status),
            [
                {"label": "クリスタ", "minutes": 12, "counting": True},
                {"label": "スレスパ", "minutes": 0, "counting": False},
            ],
        )

    def test_待機中は全部計測中でない(self):
        status = {
            "counting": False,
            "target": None,
            "totals": {"clipstudio": {"label": "クリスタ", "seconds": 0}},
        }
        self.assertEqual(
            cell_items(status),
            [{"label": "クリスタ", "minutes": 0, "counting": False}],
        )


if __name__ == "__main__":
    unittest.main()
