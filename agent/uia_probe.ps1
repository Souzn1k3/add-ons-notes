Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$conds = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $conds)
foreach ($w in $wins) {
    $name = $w.Current.Name
    if ($name -match 'Samsung Notes') {
        Write-Output ("WINDOW: " + $name + " | id=" + $w.Current.AutomationId + " | class=" + $w.Current.ClassName)
        $elements = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        Write-Output ("  total descendants: " + $elements.Count)
        $i = 0
        foreach ($e in $elements) {
            $c = $e.Current
            if ($c.ControlType.ProgrammaticName -in 'ControlType.Button','ControlType.Menu','ControlType.ListItem','ControlType.Edit','ControlType.Document','ControlType.Text' ) {
                if ($c.Name -and $i -lt 60) {
                    Write-Output ("  [" + $c.ControlType.ProgrammaticName + "] name=" + $c.Name + " | id=" + $c.AutomationId)
                    $i++
                }
            }
        }
    }
}
