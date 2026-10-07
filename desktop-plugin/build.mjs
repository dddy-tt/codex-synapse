import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const read = path => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const [page, css, bridge, app] = await Promise.all([
  read('./src/index.html'), read('./src/styles.css'),
  read('./src/embedded-bridge.js'), read('./src/app.js'),
])
for (const marker of ['<!-- SYNAPSE_STYLES -->', '<!-- SYNAPSE_APP -->']) {
  if (!page.includes(marker)) throw new Error(`Missing page marker: ${marker}`)
}
const inlineScript = `${bridge}\n${app}`.replaceAll('</script', '<\\/script')
const html = page
  .replace('<!-- SYNAPSE_STYLES -->', `<style>${css}</style>`)
  .replace('<body>', '<body class="codex-embedded">')
  .replace('<!-- SYNAPSE_APP -->', `<script>${inlineScript}</script>`)
await mkdir(fileURLToPath(new URL('./dist/', import.meta.url)), { recursive: true })
await writeFile(fileURLToPath(new URL('./dist/panel.html', import.meta.url)), html, 'utf8')
console.log(`MCP App map built: ${Buffer.byteLength(html)} bytes`)
