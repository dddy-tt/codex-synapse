import { spawn, execFileSync } from 'node:child_process'

function childEnvironment() {
  const env = { ...process.env }
  if (env.HTTPS_PROXY || env.https_proxy || process.platform !== 'win32') return env
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
    const enabled = execFileSync('reg.exe', ['query', key, '/v', 'ProxyEnable'], { encoding: 'utf8', windowsHide: true })
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(enabled)) return env
    const setting = execFileSync('reg.exe', ['query', key, '/v', 'ProxyServer'], { encoding: 'utf8', windowsHide: true })
    const raw = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(setting)?.[1]?.trim()
    const entry = raw?.includes('=') ? raw.split(';').find(item => item.startsWith('https='))?.slice(6) : raw
    const url = new URL(entry?.includes('://') ? entry : `http://${entry}`)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port) return env
    env.HTTPS_PROXY = url.href
    env.HTTP_PROXY = url.href
    env.NO_PROXY ??= '127.0.0.1,localhost'
  } catch { /* system proxy is optional */ }
  return env
}

export class CodexClient {
  constructor() {
    this.process = null
    this.pending = new Map()
    this.listeners = new Set()
    this.nextId = 1
    this.buffer = ''
    this.ready = null
  }

  async connect() {
    if (this.ready) return this.ready
    this.ready = this.start()
    try { await this.ready } catch (error) { this.ready = null; throw error }
  }

  async start() {
    const executable = process.env.CODEX_BIN ?? 'codex.exe'
    const child = spawn(executable, ['app-server', '--stdio', '-c', 'mcp_servers={}'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: childEnvironment() })
    this.process = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => this.read(chunk))
    child.stderr.resume()
    child.on('exit', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Codex app-server 已退出'))
      this.pending.clear()
      this.process = null
      this.ready = null
    })
    child.on('error', error => {
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
      this.process = null
      this.ready = null
    })
    await this.request('initialize', { clientInfo: { name: 'codex_synapse', title: 'Codex Synapse', version: '0.2.0' } })
    this.notify('initialized', {})
  }

  read(chunk) {
    this.buffer += chunk
    let newline
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      let message
      try { message = JSON.parse(line) } catch { continue }
      const pending = this.pending.get(message.id)
      if (pending) {
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error) pending.reject(new Error(message.error.message ?? 'Codex 请求失败'))
        else pending.resolve(message.result)
      } else if (message.method && message.id != null) {
        for (const listener of this.listeners) listener({ ...message, serverRequest: true })
        this.process?.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: '此地图无法处理该操作' } }) + '\n')
      } else if (message.method) {
        for (const listener of this.listeners) listener(message)
      }
    }
  }

  request(method, params, timeoutMs = 30000) {
    if (!this.process?.stdin.writable) return Promise.reject(new Error('Codex 服务未连接'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex 请求超时')) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.process.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }

  notify(method, params) {
    this.process?.stdin.write(JSON.stringify({ method, params }) + '\n')
  }

  onNotification(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close() { this.process?.kill() }
}
