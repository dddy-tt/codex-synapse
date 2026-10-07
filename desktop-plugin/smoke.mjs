import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const client = new Client({ name: 'synapse-smoke', version: '0.1.0' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['mcp-server.mjs'] }))
const tools = await client.listTools()
const resources = await client.listResources()
const resource = await client.readResource({ uri: resources.resources[0].uri })
const api = await client.callTool({ name: 'synapse_api', arguments: { path: '/api/sessions' } })
const response = JSON.parse(api.content[0].text)
console.log(JSON.stringify({ capabilities: client.getServerCapabilities(), tool: tools.tools[0]?.name, entrypoints: tools.tools[0]?._meta?.['openai/ui']?.entrypoints, resource: resources.resources[0]?.uri, mime: resource.contents[0]?.mimeType, bytes: resource.contents[0]?.text?.length, apiStatus: response.status, sessionCount: response.data.count }))
await client.close()
