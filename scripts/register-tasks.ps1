# scripts/register-tasks.ps1
# tracker（Node）と tray（Python）を「ログオン時」にタスクスケジューラへ登録する。
# 管理者権限は不要。同じ名前のタスクがあれば上書きする（何度実行しても二重登録にならない）。
#
# 使い方 (Windows PowerShell):
#   .\scripts\register-tasks.ps1            登録して、すぐ起動する
#   .\scripts\register-tasks.ps1 -Remove    動いているものを止めて、登録を削除する
#
# 前提: node が PATH にあること。tray\.venv が作成済みであること。
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$trackerName = 'AppTime Tracker'
$trayName = 'AppTime Tray'

# Stop-ScheduledTask は起動元の窓しか止めず、子の node / pythonw は残る。
# 残ると 17600 番を握ったまま次の起動が失敗するので、コマンドラインで探して止める
function Stop-Leftovers {
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='pythonw.exe'" |
        Where-Object { $_.CommandLine -match 'src\\tracker\.js|tray\\tray\.py|tray\.py$' }
    foreach ($p in $procs) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "止めました: PID $($p.ProcessId) $($p.Name)"
    }
}

if ($Remove) {
    foreach ($name in $trackerName, $trayName) {
        if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
            Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
            Write-Host "削除しました: $name"
        }
    }
    Stop-Leftovers
    return
}

$node = (Get-Command node -ErrorAction Stop).Source
$pythonw = Join-Path $root 'tray\.venv\Scripts\pythonw.exe'
if (-not (Test-Path $pythonw)) { throw "tray の venv が見つかりません: $pythonw" }

# 電源まわりとタイムアウトの設定。ExecutionTimeLimit=0 は「時間制限なし」（既定の 72 時間で止めないため）
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
# ログオン中の対話セッションで動かす（トレイとオーバーレイは画面が必要）
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# tracker は本体が Node のコンソールアプリなので、PowerShell の窓を隠して起動する
$trackerArgs = "-NoProfile -WindowStyle Hidden -Command `"Set-Location '$root'; & '$node' src\tracker.js`""
$trackerAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $trackerArgs -WorkingDirectory $root
Register-ScheduledTask -TaskName $trackerName -Action $trackerAction -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "登録しました: $trackerName"

# tray は pythonw（窓なし）で起動する
$trayAction = New-ScheduledTaskAction -Execute $pythonw -Argument 'tray\tray.py' -WorkingDirectory $root
Register-ScheduledTask -TaskName $trayName -Action $trayAction -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "登録しました: $trayName"

# 手動や前回の登録で残っているものを先に止めてから起動する（二重起動とポート競合を防ぐ）
Stop-ScheduledTask -TaskName $trackerName -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName $trayName -ErrorAction SilentlyContinue
Stop-Leftovers
Start-ScheduledTask -TaskName $trackerName
Start-Sleep -Seconds 3
Start-ScheduledTask -TaskName $trayName
Write-Host "起動しました。WebUI: http://127.0.0.1:17600/"
