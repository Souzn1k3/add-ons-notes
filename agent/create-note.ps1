param(
    [long]$TargetHwnd = 0,
    [string]$Text = '',
    [switch]$TypeOnly
)

$ErrorActionPreference = 'Stop'
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
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    public const uint KEYEVENTF_UNICODE = 0x0004;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;

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
}
'@

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

# если приложение не запущено вообще (hwnd недоступен поверх): пользователь сначала запускает из install.bat / вручную;
# допускаем только сценарий с запущенным приложением.

$h = [IntPtr]$TargetHwnd
if ([W]::IsIconic($h)) { [W]::ShowWindow($h, 9) | Out-Null }
[W]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 700

if ($TypeOnly) {
    # просто ввести текст в уже сфокусированный редактор
    [W]::TypeUnicode($Text)
    exit 0
}

# если открыт редактор — назад к списку
$back = $e.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'BackButton')))
if ($back) {
    try { ($back.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke() | Out-Null } catch { }
    Start-Sleep -Milliseconds 1100
}

$create = $e.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'CreateNoteButton')))
if (-not $create) { throw 'CreateNoteButton not found' }
$cr = $create.Current.BoundingRectangle
Click-Point ($cr.X + $cr.Width/2) ($cr.Y + $cr.Height/2)
Start-Sleep -Milliseconds 1800

$addPage = $e.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'AddPageButton')))
if (-not $addPage) { throw 'editor did not open' }

$composer = $e.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'SpenComposerViewScrollViewer')))
if ($composer) {
    $pr = $composer.Current.BoundingRectangle
    Click-Point ($pr.X + $pr.Width/2) ($pr.Y + $pr.Height/2 + [Math]::Min(60, $pr.Height*0.08))
}
Start-Sleep -Milliseconds 400

foreach ($chunk in ($Text -split "`n")) {
    [W]::TypeUnicode($chunk)
    [W]::PressEnter()
    Start-Sleep -Milliseconds 80
}
Start-Sleep -Milliseconds 1200

Write-Output 'OK'
