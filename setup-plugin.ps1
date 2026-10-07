$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction Stop).Source
$pluginDir = Join-Path $PSScriptRoot 'desktop-plugin'
$server = Join-Path $pluginDir 'mcp-server.mjs'
$config = @{
  mcpServers = @{
    synapse = @{
      command = $node
      args = @($server)
      cwd = $pluginDir
    }
  }
} | ConvertTo-Json -Depth 5
Set-Content -LiteralPath (Join-Path $pluginDir '.mcp.json') -Value $config -Encoding utf8
Write-Output "已生成 $pluginDir\.mcp.json"
