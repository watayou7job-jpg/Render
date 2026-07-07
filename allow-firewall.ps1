New-NetFirewallRule -DisplayName "Wedding Quiz App (TCP 3001)" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Any
Write-Host "ファイアウォール規則を追加しました。"
