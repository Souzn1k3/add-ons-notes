param([int]$TargetHwnd = 0, [string]$Action = 'probe')

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$e = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$TargetHwnd)

if ($Action -eq 'click-back') {
    $btn = $e.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'BackButton')))
    if ($btn) {
        $inv = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $inv.Invoke()
        Start-Sleep -Milliseconds 900
        Write-Output 'BackButton invoked'
    } else { Write-Output 'BackButton not found (list view?)' }
}

$elements = $e.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$i = 0
foreach ($el in $elements) {
    $c = $el.Current
    if ($i -ge 120) { break }
    if ($c.ControlType.ProgrammaticName -eq 'ControlType.Button') {
        Write-Output ("  BTN | " + $c.Name + " | id=" + $c.AutomationId)
        $i++
    }
}
