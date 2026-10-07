import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { z } from 'zod'

const URI = 'ui://codex-synapse/map-v5.html'
const html = readFileSync(fileURLToPath(new URL('./dist/panel.html', import.meta.url)), 'utf8')
const server = new McpServer(
  { name: 'codex-synapse', version: '0.1.0' },
  { capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } } },
)
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function ensureWeb() {
  try {
    const response = await fetch('http://127.0.0.1:4318/api/health', { signal: AbortSignal.timeout(1500) })
    if (response.ok) return
  } catch { /* start the local web service below */ }
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: webRoot, detached: true, windowsHide: true, stdio: 'ignore',
  })
  child.unref()
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 200))
    try {
      const response = await fetch('http://127.0.0.1:4318/api/health', { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch { /* wait for startup */ }
  }
  throw new Error('Synapse 本机服务未能启动')
}

registerAppResource(server, 'codex-synapse-map', URI, {}, async () => { await ensureWeb(); return ({
  contents: [{
    uri: URI,
    mimeType: RESOURCE_MIME_TYPE,
    text: html,
    _meta: {
      ui: {},
      'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] },
    },
  }],
}) })

registerAppTool(server, 'open_synapse_map', {
  title: 'Synapse 会话地图',
  description: '在 Codex 桌面端打开本机 Synapse 会话地图，查看会话并创建追问分支。',
  inputSchema: {},
  _meta: {
    ui: { resourceUri: URI, visibility: ['app'] },
    'openai/ui': { entrypoints: [{ type: 'global' }] },
  },
}, async () => { await ensureWeb(); return ({ content: [{ type: 'text', text: 'Synapse 会话地图已打开。' }] }) })

server.registerTool('synapse_api', {
  title: 'Synapse 本机接口',
  description: '供 Synapse 页面读取本地会话、创建分支与继续追问。',
  inputSchema: {
    path: z.string(),
    method: z.enum(['GET', 'POST']).optional(),
    body: z.unknown().optional(),
  },
  _meta: { ui: { visibility: ['app'] } },
}, async ({ path, method = 'GET', body }) => {
  if (!/^\/api\/(?:sessions|session\/[0-9a-f-]{36}|branches|branch\/[0-9a-f-]{36}(?:\/ask)?|open-thread)$/.test(path)) {
    throw new Error('不支持的 Synapse 接口路径')
  }
  await ensureWeb()
  const response = await fetch(`http://127.0.0.1:4318${path}`, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    signal: AbortSignal.timeout(35000),
  })
  const data = await response.json()
  return { content: [{ type: 'text', text: JSON.stringify({ status: response.status, data }) }] }
})

await server.connect(new StdioServerTransport())
