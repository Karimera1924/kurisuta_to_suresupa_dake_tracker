# AppTimeTracker.ps1
# クリスタとスレスパの操作時間だけを数える、最小版です。
# ルール: 対象アプリが前面にあり、最後の入力 (キーボード / マウス / ペン) から
# 30秒以内なら、その時間を操作時間として加算します。5秒ごとに判定します。
#
# 記録するのは、日次の合計と区間だけです。
# キー入力の中身、ファイル名、ウィンドウタイトルは記録しません。
#
# 使い方 (Windows PowerShell):
#   右クリック -> PowerShell で実行、またはプロンプトから
#     .\AppTimeTracker.ps1
#   止めるときは Ctrl+C。合計は判定のたびに保存されるので、止めても消えません。
#
# 出力 (ドキュメント\AppTime):
#   2026-10-31-summary.csv   -> 日付, アプリ, 合計秒, 合計分, 更新時刻
#   2026-10-31-sessions.csv  -> 日付, アプリ, 開始, 終了, 秒
#
# 実行中は、コンソールに現在の状態 (計測中のアプリと本日の合計) が表示されます。
# 同じ日に再起動した場合は、その日の合計ファイルがあれば続きから数えます。
#
# 注意 (未検証): ペン入力が Windows の最終入力時刻に反映されるかは環境依存です。
# ペンだけで1分ほど描いて、合計が増えるか確認してください。
# スレスパの判定は、プロセス名 SlayTheSpire / タイトル Slay the Spire で行います。

# IdleSeconds: 最後の入力から何秒までを操作時間とするか
# PollSeconds: 判定の間隔 (秒)
param(
    [int]$IdleSeconds = 30,
    [int]$PollSeconds = 5
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO {
        public uint cbSize;
        public uint dwTime;
    }
}
"@

$Targets = @(
    @{ Key = 'clipstudio';   Label = 'クリスタ'; ProcessPattern = 'ClipStudio';   TitlePattern = 'CLIP STUDIO PAINT' },
    @{ Key = 'slaythespire'; Label = 'スレスパ'; ProcessPattern = 'SlayTheSpire'; TitlePattern = 'Slay the Spire' }
)

function Get-IdleMilliseconds {
    $lii = New-Object Win32+LASTINPUTINFO
    $lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
    if (-not [Win32]::GetLastInputInfo([ref]$lii)) { return [int]::MaxValue }
    # どちらも 2^32 で回るミリ秒カウンタなので、巻き戻りを処理する
    $elapsed = [Environment]::TickCount - [int]$lii.dwTime
    if ($elapsed -lt 0) { $elapsed += 4294967296 }
    return $elapsed
}

function Format-Duration([int]$sec) {
    # 秒を読みやすい表記にする (例: 45秒 / 3分25秒 / 1時間15分30秒)
    if ($sec -lt 60) { return "${sec}秒" }
    $h = [math]::Floor($sec / 3600)
    $m = [math]::Floor(($sec % 3600) / 60)
    $s = $sec % 60
    if ($h -gt 0) { return "${h}時間${m}分${s}秒" }
    return "${m}分${s}秒"
}

function Get-ForegroundTarget {
    $hwnd = [Win32]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) { return $null }
    try {
        $proc = Get-Process | Where-Object { $_.MainWindowHandle -eq $hwnd } | Select-Object -First 1
        $sb = New-Object System.Text.StringBuilder 512
        [void][Win32]::GetWindowText($hwnd, $sb, $sb.Capacity)
        $title = $sb.ToString()
        foreach ($t in $Targets) {
            # プロセス名とタイトルは照合にだけ使い、ディスクには書かない
            if ($null -ne $proc -and $proc.ProcessName -match $t.ProcessPattern) { return $t }
            if ($title -match $t.TitlePattern) { return $t }
        }
    } catch { return $null }
    return $null
}

$outDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'AppTime'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$today = (Get-Date).ToString('yyyy-MM-dd')
$summaryPath = Join-Path $outDir "$today-summary.csv"
$sessionsPath = Join-Path $outDir "$today-sessions.csv"
if (-not (Test-Path $sessionsPath)) {
    'date,app,start,end,seconds' | Out-File -FilePath $sessionsPath -Encoding utf8
}

$totals = @{}
foreach ($t in $Targets) { $totals[$t.Key] = 0 }
# 同じ日の合計ファイルが残っていれば、再起動時はそこから引き継ぐ
if (Test-Path $summaryPath) {
    try {
        foreach ($row in (Import-Csv -Path $summaryPath -Encoding utf8)) {
            foreach ($t in $Targets) {
                if ($row.app -eq $t.Label) { $totals[$t.Key] = [int]$row.total_seconds }
            }
        }
    } catch { }
}
$segmentApp = $null
$segmentStart = $null
$segmentEnd = $null

function Write-Summary {
    $lines = @('date,app,total_seconds,total_minutes,updated_at')
    foreach ($t in $Targets) {
        $sec = $totals[$t.Key]
        $lines += "$today,$($t.Label),$sec,$([math]::Round($sec / 60, 1)),$((Get-Date).ToString('HH:mm:ss'))"
    }
    ($lines -join "`r`n") | Out-File -FilePath $summaryPath -Encoding utf8
}

function Flush-Segment {
    if ($null -ne $segmentApp -and $null -ne $segmentStart -and $null -ne $segmentEnd) {
        $seconds = [int](($segmentEnd - $segmentStart).TotalSeconds + $PollSeconds)
        "$today,$($segmentApp.Label),$($segmentStart.ToString('HH:mm:ss')),$($segmentEnd.ToString('HH:mm:ss')),$seconds" |
            Out-File -FilePath $sessionsPath -Encoding utf8 -Append
    }
    $script:segmentApp = $null
    $script:segmentStart = $null
    $script:segmentEnd = $null
}

Write-Host "AppTimeTracker を開始しました。数えるのは クリスタ と スレスパ だけです (最終入力から $IdleSeconds 秒以内)。"
Write-Host "出力先: $outDir  (止めるときは Ctrl+C)"

try {
    while ($true) {
        $now = Get-Date
        $target = Get-ForegroundTarget
        $counting = ($null -ne $target) -and ((Get-IdleMilliseconds) -le ($IdleSeconds * 1000))
        if ($counting) {
            if ($null -eq $segmentApp -or $segmentApp.Key -ne $target.Key) {
                Flush-Segment
                $segmentApp = $target
                $segmentStart = $now
            }
            $segmentEnd = $now
            $totals[$target.Key] += $PollSeconds
            Write-Summary
        } else {
            Flush-Segment
        }
        $status = ''
        if ($counting) {
            $status = "計測中: $($target.Label)"
        } elseif ($null -ne $target) {
            $status = "待機中: $($target.Label) は前面ですが、入力がありません"
        } else {
            $status = '待機中: 対象アプリは前面にありません'
        }
        $status += " / 本日 クリスタ $(Format-Duration $totals['clipstudio']) ・ スレスパ $(Format-Duration $totals['slaythespire'])"
        # キャリッジリターンで行頭に戻り、同じ行を上書きする。前の表示が残らないよう、
        # 全角を2として表示幅を数え、行末まで空白で埋める。
        $winWidth = 120
        try { $winWidth = $Host.UI.RawUI.WindowSize.Width } catch { }
        $dispWidth = 0
        foreach ($ch in $status.ToCharArray()) { if ([int]$ch -gt 255) { $dispWidth += 2 } else { $dispWidth += 1 } }
        $pad = [Math]::Max(0, ($winWidth - 1) - $dispWidth)
        Write-Host ("`r" + $status + (' ' * $pad)) -NoNewline
        Start-Sleep -Seconds $PollSeconds
    }
} finally {
    Write-Host ''
    Flush-Segment
    Write-Summary
    Write-Host "止めました。今日の合計: クリスタ $(Format-Duration $totals['clipstudio']) / スレスパ $(Format-Duration $totals['slaythespire'])"
}
