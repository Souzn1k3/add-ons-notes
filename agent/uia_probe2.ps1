param([int]$TargetHwnd = 0)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

if (-not $TargetHwnd) {
    # найти CoreWindow через корень
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($w in $wins) {
        if ($w.Current.ClassName -eq 'Windows.UI.Core.CoreWindow' -and $w.Current.Name -match 'Samsung') {
            $TargetHwnd = $w.Current.NativeWindowHandle
            break
        }
    }
}
if (-not $TargetHwnd) { Write-Output 'CoreWindow not found'; exit 1 }

$e = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$TargetHwnd)
Write-Output ("FROMHANDLE: " + $e.Current.Name + " class=" + $e.Current.ClassName)
$elements = $e.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
Write-Output ("descendants: " + $elements.Count)
$i = 0
foreach ($el in $elements) {
    $c = $el.Current
    if ($i -ge 80) { break }
    if ($c.Name) {
        Write-Output ("  " + $c.ControlType.ProgrammaticName + " | " + $c.Name + " | id=" + $c.AutomationId)
        $i++
    }
}
