param(
    [long]$TargetHwnd = 0,
    [string]$Text = ''
)

$ErrorActionPreference = 'Stop'
$LogFile = Join-Path $env:LOCALAPPDATA 'SBNAgent\bridge.log'

function Log-Step([string]$msg) {
    $line = "{0:HH:mm:ss.fff} {1}" -f (Get-Date), $msg
    try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch { }
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class W {
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk; public ushort wScan; public uint dwFlags;
        public uint time; public UIntPtr dwExtraInfo;
    }
    public struct INPUT {
        public uint type; public KEYBDINPUT ki; public int pad1; public int pad2;
    }
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr extra);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_SHOWWINDOW = 0x0040;

    public static void TypeUnicode(string s) {
        foreach (char c in s) {
            var down = new INPUT { type = 1 };
            down.ki = new KEYBDINPUT { wVk = 0, wScan = c, dwFlags = KEYEVENTF_UNICODE, time = 0, dwExtraInfo = UIntPtr.Zero };
            var up = new INPUT { type = 1 };
            up.ki = new KEYBDINPUT { wVk = 0, wScan = c, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time = 0, dwExtraInfo = UIntPtr.Zero };
            var arr = new INPUT[2];
            arr[0] = down; arr[1] = up;
            SendInput(2, arr, Marshal.SizeOf(typeof(INPUT)));
            System.Threading.Thread.Sleep(6);
        }
    }
    public static void PressEnter() {
        var down = new INPUT { type = 1 };
        down.ki = new KEYBDINPUT { wVk = 13, wScan = 0, dwFlags = 0, time = 0, dwExtraInfo = UIntPtr.Zero };
        var up = new INPUT { type = 1 };
        up.ki = new KEYBDINPUT { wVk = 13, wScan = 0, dwFlags = KEYEVENTF_KEYUP, time = 0, dwExtraInfo = UIntPtr.Zero };
        var arr = new INPUT[2];
        arr[0] = down; arr[1] = up;
        SendInput(2, arr, Marshal.SizeOf(typeof(INPUT)));
    }
    public const uint KEYEVENTF_UNICODE = 0x0004;
    public const uint KEYEVENTF_KEYUP = 0x0002;
}
'@
Log-Step "START hwnd=$TargetHwnd textLen=$($Text.Length)"

function Find-ById($parent, [string]$autoId, [int]$retries = 5, [int]$delayMs = 700) {
    for ($i = 0; $i -lt $retries; $i++) {
        try {
            $el = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
                (New-Object System.Windows.Automation.PropertyCondition(
                    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $autoId)))
            if ($el) { return $el }
        } catch {
            Log-Step "find $autoId error: $($_.Exception.Message)"
        }
        Start-Sleep -Milliseconds $delayMs
    }
    return $null
}

function Click-Point([double]$x, [double]$y) {
    [W]::SetCursorPos([int]$x, [int]$y) | Out-Null
    Start-Sleep -Milliseconds 120
    [W]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [W]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 200
}

$e = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$TargetHwnd)
if (-not $e) { throw 'window not accessible' }
Log-Step 'from-handle ok'

$h = [IntPtr]$TargetHwnd
$raised = $false
try {
    # поднять окно поверх всех: иначе клики попадут в перекрывающий браузер,
    # а SetForegroundWindow из фонового процесса Windows блокирует
    if ([W]::IsIconic($h)) { [W]::ShowWindow($h, 9) | Out-Null }
    [W]::SetWindowPos($h, [W]::HWND_TOPMOST, 0, 0, 0, 0,
        [W]::SWP_NOMOVE -bor [W]::SWP_NOSIZE -bor [W]::SWP_SHOWWINDOW) | Out-Null
    $raised = $true
    [W]::BringWindowToTop($h) | Out-Null
    for ($i = 0; $i -lt 4; $i++) {
        [W]::SetForegroundWindow($h) | Out-Null
        Start-Sleep -Milliseconds 350
        $fg = [W]::GetForegroundWindow()
        Log-Step ("fg=" + $fg.ToInt64() + " target=" + $h.ToInt64())
        if ($fg -eq $h) { break }
    }
    Start-Sleep -Milliseconds 300

    # если открыт редактор — назад к списку
    $back = Find-ById $e 'BackButton' 2 500
    if ($back) {
        try { ($back.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke() | Out-Null } catch { }
        Log-Step 'back-to-list invoked'
        Start-Sleep -Milliseconds 1200
    }

    $create = Find-ById $e 'CreateNoteButton' 6 800
    if (-not $create) { Log-Step 'FAIL create button not found'; throw 'CreateNoteButton not found' }
    Log-Step 'create-button found'
    $cr = $create.Current.BoundingRectangle
    Log-Step ("click-create at " + [int]$cr.X + "," + [int]$cr.Y)
    Click-Point ($cr.X + $cr.Width/2) ($cr.Y + $cr.Height/2)
    Start-Sleep -Milliseconds 1200

    $addPage = Find-ById $e 'AddPageButton' 8 700
    if (-not $addPage) { Log-Step 'FAIL editor not opened'; throw 'editor did not open (AddPageButton time-out)' }
    Log-Step 'addpage found'

    $composer = Find-ById $e 'SpenComposerViewScrollViewer' 6 700
    if (-not $composer) { Log-Step 'FAIL composer not found'; throw 'composer canvas not found' }
    Log-Step 'composer found'
    $pr = $composer.Current.BoundingRectangle
    Click-Point ($pr.X + $pr.Width/2) ($pr.Y + $pr.Height/2 + [Math]::Min(60, $pr.Height*0.08))

    Log-Step 'typing start'
    foreach ($chunk in ($Text -split "`n")) {
        [W]::TypeUnicode($chunk)
        [W]::PressEnter()
        Start-Sleep -Milliseconds 80
    }
    Log-Step 'typing done'
    Start-Sleep -Milliseconds 1200

    $back2 = Find-ById $e 'BackButton' 5 600
    if ($back2) {
        try { ($back2.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke() | Out-Null } catch { }
        Log-Step 'back invoked'
        Start-Sleep -Milliseconds 900
    }
    Log-Step 'done'
    Write-Output 'OK'
}
finally {
    if ($raised) {
        [W]::SetWindowPos($h, [W]::HWND_NOTOPMOST, 0, 0, 0, 0,
            [W]::SWP_NOMOVE -bor [W]::SWP_NOSIZE) | Out-Null
        Log-Step 'topmost-restored'
    }
}
