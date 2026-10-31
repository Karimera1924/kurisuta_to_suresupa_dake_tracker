import unittest
from unittest import mock

import tray
from tray import build_tooltip, refresh_once, status_from_json


class StatusFromJsonTest(unittest.TestCase):
    def test_totalsのある辞書はそのまま返す(self):
        data = {"counting": False, "totals": {}}
        self.assertIs(status_from_json(data), data)

    def test_辞書でなければ未接続扱い(self):
        self.assertIsNone(status_from_json(["totals"]))
        self.assertIsNone(status_from_json(None))

    def test_totalsが無い時は未接続扱い(self):
        self.assertIsNone(status_from_json({"counting": True}))

    def test_totalsが辞書でなければ未接続扱い(self):
        self.assertIsNone(status_from_json({"totals": [1, 2]}))


class RefreshOnceTest(unittest.TestCase):
    def test_未接続ならツールチップを未接続にする(self):
        icon = mock.Mock()
        overlay = mock.Mock()
        with mock.patch.object(tray, "fetch_status", return_value=None):
            refresh_once(icon, overlay)
        self.assertEqual(icon.title, "アプリ時間: 未接続")
        overlay.set_status.assert_called_once_with(None)

    def test_表示更新で例外が出てもログに残して止まらない(self):
        icon = mock.Mock()
        overlay = mock.Mock()
        overlay.set_status.side_effect = RuntimeError("描画できない")
        with mock.patch.object(tray, "fetch_status", return_value=None), mock.patch.object(
            tray, "log_error"
        ) as log:
            refresh_once(icon, overlay)  # 例外は外へ出ない
        log.assert_called_once()


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
