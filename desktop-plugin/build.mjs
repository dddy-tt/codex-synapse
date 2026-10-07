import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const read = path => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const [page, css, bridge, app] = await Promise.all([
  read('../public/index.html'), read('../public/styles.css'),
  read('./src/embedded-bridge.js'), read('../public/app.js'),
])
const inlineScript = `${bridge}\n${app}`.replaceAll('</script', '<\\/script')
const html = page
  .replace('<link rel="stylesheet" href="/styles.css">', `<style>${css}</style>`)
  .replace('<body>', '<body class="codex-embedded">')
  .replace('<script type="module" src="/app.js"></script>', `<script>${inlineScript}</script>`)
await mkdir(fileURLToPath(new URL('./dist/', import.meta.url)), { recursive: true })
await writeFile(fileURLToPath(new URL('./dist/panel.html', import.meta.url)), html, 'utf8')
console.log(`MCP App map built: ${Buffer.byteLength(html)} bytes`)
