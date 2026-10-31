import unittest

from tray import build_tooltip


class BuildTooltipTest(unittest.TestCase):
    def test_未接続のとき(self):
        self.assertEqual(build_tooltip(None), "アプリ時間: 未接続")

    def test_計測中は対象名と分を出す(self):
        status = {
            "counting": True,
            "target": "clipstudio",
            "totals": {
                "clipstudio": {"label": "クリスタ", "seconds": 725},
                "slaythespire": {"label": "スレスパ", "seconds": 59},
            },
        }
        self.assertEqual(
            build_tooltip(status),
            "アプリ時間 計測中: クリスタ | クリスタ 12分 / スレスパ 0分",
        )

    def test_待機中は待機中と出す(self):
        status = {
            "counting": False,
            "target": None,
            "totals": {"clipstudio": {"label": "クリスタ", "seconds": 0}},
        }
        self.assertEqual(build_tooltip(status), "アプリ時間 待機中 | クリスタ 0分")

    def test_長くても上限で切る(self):
        totals = {
            f"k{i}": {"label": "長い名前の対象" * 3, "seconds": 60} for i in range(20)
        }
        status = {"counting": False, "target": None, "totals": totals}
        self.assertLessEqual(len(build_tooltip(status)), 127)


if __name__ == "__main__":
    unittest.main()
