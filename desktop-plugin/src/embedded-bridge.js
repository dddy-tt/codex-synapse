// The Codex MCP App sandbox cannot fetch localhost directly. Route the map's
// API requests through its app-only MCP tool.
const pending = new Map()
let nextId = 1

function mcpRequest(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Codex 插件通信超时：${method}`))
    }, 40000)
    pending.set(id, { resolve, reject, timeout })
    window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*')
  })
}

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.jsonrpc !== '2.0') return
  const message = event.data
  if (message.method && message.id !== undefined) {
    window.parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, '*')
    return
  }
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  clearTimeout(request.timeout)
  if (message.error) request.reject(new Error(message.error.message || 'Codex 插件调用失败'))
  else request.resolve(message.result)
})

const bridgeReady = mcpRequest('ui/initialize', {
  appInfo: { name: 'Codex Synapse', version: '0.1.0' },
  appCapabilities: {},
  protocolVersion: '2026-01-26',
}).then(result => {
  if (!result?.hostInfo) throw new Error('Codex 插件握手失败')
  window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, '*')
})

async function fetch(url, options = {}) {
  if (typeof url !== 'string' || !url.startsWith('/api/')) throw new Error('不支持的本机接口')
  await bridgeReady
  const result = await mcpRequest('tools/call', {
    name: 'synapse_api',
    arguments: {
      path: url,
      method: options.method || 'GET',
      ...(options.body ? { body: JSON.parse(options.body) } : {}),
    },
  })
  if (result?.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text || 'Synapse 接口失败')
  const payload = JSON.parse(result?.content?.find(item => item.type === 'text')?.text || '{}')
  return {
    ok: payload.status >= 200 && payload.status < 300,
    status: payload.status,
    json: async () => payload.data,
  }
}
