const canvas = document.querySelector('#canvas')
const nodes = document.querySelector('#nodes')
const wires = document.querySelector('#wires')
const inspector = document.querySelector('#inspector')
const shell = document.querySelector('.shell')
const detailsButton = document.querySelector('#details')
const search = document.querySelector('#search')
const list = document.querySelector('#session-list')
const template = document.querySelector('#card-template')
let sessions = []
let selectedSession = null
let turns = []
let branches = []
let camera = { x: 0, y: 0, scale: 1 }
let dragging = null
let requestNumber = 0
let selectedBranchId = null
let selectedTurnNumber = null
let draftTurn = null
const openProjects = new Set()
let searchOpenProjects = null

function setInspectorOpen(open) {
  shell.classList.toggle('inspector-open', open)
  detailsButton.setAttribute('aria-expanded', String(open))
  detailsButton.textContent = open ? '收起详情' : '显示详情'
}

const formatTime = value => new Intl.DateTimeFormat('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(value))
const workspaceName = cwd => cwd === '未关联工作区' ? cwd : cwd.replaceAll('\\','/').split('/').filter(Boolean).at(-1)
const projectKey = cwd => cwd === '未关联工作区' ? '@unlinked' : String(cwd).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }
function transform() {
  const value = `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`
  nodes.style.transform = value
  wires.style.transform = value
}
function resetCamera() { camera = { x: 0, y: 0, scale: 1 }; transform() }
function focusPoint(x, y) {
  camera.x = canvas.clientWidth / 2 - (x + 140) * camera.scale
  camera.y = canvas.clientHeight / 2 - (y + 106) * camera.scale
  transform()
}
function focusBranch(branch) {
  const point = graphLayout().branchPositions.get(branch.id)
  if (point) focusPoint(point.x, point.y)
}

function graphLayout() {
  const cols = Math.max(1, Math.ceil(Math.sqrt(turns.length / 1.6)))
  const rowCount = Math.ceil(turns.length / cols)
  const extraRows = Array(rowCount).fill(0)
  const sourceRow = number => Math.floor((number - 1) / cols)
  for (const branch of branches) if (turns[branch.sourceTurn - 1]) extraRows[sourceRow(branch.sourceTurn)]++
  if (draftTurn && turns[draftTurn.number - 1]) extraRows[sourceRow(draftTurn.number)]++
  const rowStarts = []
  let offset = 0
  for (let row = 0; row < rowCount; row++) {
    rowStarts[row] = row + offset
    offset += extraRows[row]
  }
  const turnPositions = turns.map((_, index) => {
    const row = Math.floor(index / cols)
    return { x: 60 + (index % cols) * 340, y: 64 + rowStarts[row] * 270 }
  })
  const usedSlots = Array(rowCount).fill(0)
  const afterSource = number => {
    const source = turnPositions[number - 1]
    if (!source) return null
    const row = sourceRow(number)
    return { x: source.x + 80, y: 64 + (rowStarts[row] + 1 + usedSlots[row]++) * 270 }
  }
  const branchPositions = new Map()
  for (const branch of branches) {
    const point = afterSource(branch.sourceTurn)
    if (point) branchPositions.set(branch.id, point)
  }
  const draftPosition = draftTurn ? afterSource(draftTurn.number) : null
  return { cols, turnPositions, branchPositions, draftPosition, totalRows: rowCount + offset }
}

async function postJson(url, body) {
  const response = await fetch(url, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`)
  return data
}

async function openThread(threadId, errorElement) {
  try { await postJson('/api/open-thread', { threadId }) }
  catch (error) { if (errorElement) errorElement.textContent = error.message }
}

function openBranchDraft(turn) {
  draftTurn = turn
  setInspectorOpen(false)
  renderMap()
  const point = graphLayout().turnPositions[turn.number - 1]
  if (point) focusPoint(point.x, point.y + 130)
  document.querySelector('#draft-input')?.focus()
}

async function createBranch(turn, prompt) {
  const button = document.querySelector('#draft-send')
  button.disabled = true
  button.textContent = '创建中…'
  try {
    const { branch } = await postJson('/api/branches', { sourceId:selectedSession.id, sourceTurn:turn.number })
    draftTurn = null
    branches.push(branch)
    renderMap()
    inspectBranch(branch)
    focusBranch(branch)
    try {
      const { message } = await postJson(`/api/branch/${branch.id}/ask`, { prompt })
      branch.messages.push(message)
      renderMap()
      inspectBranch(branch)
      pollBranch(branch.id)
    } catch (error) {
      document.querySelector('#branch-error').textContent = `分支已建立，追问未发送：${error.message}`
    }
  } catch (error) {
    button.disabled = false
    button.textContent = '发送并创建分支'
    document.querySelector('#draft-error').textContent = error.message
  }
}

function inspectBranch(branch) {
  setInspectorOpen(true)
  selectedBranchId = branch.id
  selectedTurnNumber = null
  document.querySelectorAll('.card').forEach(card => card.classList.toggle('active', card.dataset.branch === branch.id))
  const mode = branch.mode === 'native' ? 'Codex 精确分支' : '文本上下文分支'
  const messages = branch.messages.map((item, index) => `<div class="branch-exchange"><h3>追问 ${index + 1}</h3><div class="message user-message">${escapeHtml(item.prompt)}</div><h3>Codex 回复</h3><div class="message assistant-message">${escapeHtml(item.answer || item.error || '正在等待回复…')}</div></div>`).join('')
  inspector.innerHTML = `<p class="eyebrow">BRANCH · ${escapeHtml(mode)}</p><h3>起点</h3><div class="message user-message">${escapeHtml(branch.title)}</div>
    <p class="inspect-note">${branch.mode === 'native' ? '从选中的 Codex 轮次真实分叉。' : '这一张卡无法在底层会话中精确分叉；首次追问会附带截至此处的对话文本。'}</p>
    ${branch.threadId ? '<button class="primary" id="open-branch-thread">在 Codex 打开此分支</button>' : ''}
    <form id="ask-form"><label for="ask-input">继续追问</label><textarea id="ask-input" rows="5" placeholder="在这个分支里提问…" required maxlength="12000"></textarea><button class="primary" type="submit">发送追问</button></form>
    <p id="branch-error" class="error"></p><p class="inspect-note">当前追问以只读模式运行，不能修改项目文件。<br>分支会话 ID：<span class="mono">${escapeHtml(branch.threadId)}</span></p>${messages}`
  const form = document.querySelector('#ask-form')
  document.querySelector('#open-branch-thread')?.addEventListener('click', () => openThread(branch.threadId, document.querySelector('#branch-error')))
  if (branch.messages.some(item => item.status === 'running')) form.querySelector('button').disabled = true
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const prompt = form.querySelector('textarea').value.trim()
    if (!prompt) return
    form.querySelector('button').disabled = true
    document.querySelector('#branch-error').textContent = ''
    try {
      const { message } = await postJson(`/api/branch/${branch.id}/ask`, { prompt })
      branch.messages.push(message)
      renderMap()
      inspectBranch(branch)
      pollBranch(branch.id)
    } catch (error) {
      form.querySelector('button').disabled = false
      document.querySelector('#branch-error').textContent = error.message
    }
  })
}

async function pollBranch(id) {
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    if (!selectedSession || !branches.some(item => item.id === id)) return
    try {
      const response = await fetch(`/api/branch/${id}`)
      if (!response.ok) return
      const { branch } = await response.json()
      branches = branches.map(item => item.id === id ? branch : item)
      renderMap()
      if (selectedBranchId === id) inspectBranch(branch)
      if (!branch.messages.some(item => item.status === 'running')) return
    } catch { return }
  }
}

function inspect(turn) {
  setInspectorOpen(true)
  selectedTurnNumber = turn.number
  selectedBranchId = null
  document.querySelectorAll('.card').forEach(card => card.classList.toggle('active', Number(card.dataset.turn) === turn.number))
  const existing = branches.filter(branch => branch.sourceTurn === turn.number)
  const links = existing.length ? `<h3>已有分支</h3><div class="branch-links">${existing.map(branch => `<button type="button" data-open-branch="${branch.id}">${escapeHtml(branch.mode === 'native' ? '精确分支' : '文本分支')} · ${branch.messages.length} 条追问</button>`).join('')}</div>` : ''
  inspector.innerHTML = `<p class="eyebrow">TURN ${turn.number}</p>
    <h3>你的提问</h3><div class="message user-message">${escapeHtml(turn.prompt)}</div>
    <button class="primary" id="open-original-thread">在 Codex 原对话继续</button>
    <button class="secondary" id="create-branch">从此轮新建分支</button><p id="branch-error" class="error"></p>
    <p class="inspect-note">原对话继续时包含此轮之后的全部消息。${turn.canNativeFork ? '新分支从这轮完成后的真实状态开始。' : '新分支将以截至这里的对话文本作为背景。'}</p>
    ${links}<h3>Codex 回复</h3><div class="message assistant-message">${escapeHtml(turn.answer || '正在等待回复…')}</div>`
  document.querySelector('#open-original-thread').addEventListener('click', () => openThread(selectedSession.id, document.querySelector('#branch-error')))
  document.querySelector('#create-branch').addEventListener('click', () => openBranchDraft(turn))
  document.querySelectorAll('[data-open-branch]').forEach(button => button.addEventListener('click', () => {
    const branch = branches.find(item => item.id === button.dataset.openBranch)
    if (branch) { inspectBranch(branch); focusBranch(branch) }
  }))
}
function renderMap() {
  nodes.replaceChildren()
  wires.replaceChildren()
  const empty = document.querySelector('#empty')
  empty.hidden = turns.length + branches.length > 0
  empty.textContent = selectedSession ? '这个会话还没有可显示的对话' : '选择左侧会话，查看每轮对话'
  const { cols, turnPositions: positions, branchPositions, draftPosition, totalRows } = graphLayout()
  const colWidth = 340
  turns.forEach((turn, index) => {
    const { x, y } = positions[index]
    const card = template.content.firstElementChild.cloneNode(true)
    card.dataset.turn = turn.number
    card.classList.toggle('active', selectedTurnNumber === turn.number)
    card.style.left = `${x}px`
    card.style.top = `${y}px`
    card.querySelector('.card-date').textContent = `第 ${turn.number} 轮 · ${formatTime(turn.timestamp)}`
    card.querySelector('.card-prompt').textContent = turn.prompt
    card.querySelector('.card-answer').textContent = turn.answer || '正在等待回复…'
    card.querySelector('em').textContent = turn.pending ? '进行中' : '查看完整对话 ↗'
    card.addEventListener('click', event => { event.stopPropagation(); inspect(turn) })
    nodes.append(card)
  })
  for (let i = 1; i < positions.length; i++) {
    const a = positions[i - 1], b = positions[i]
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', `M ${a.x+280} ${a.y+106} C ${a.x+306} ${a.y+106}, ${b.x-24} ${b.y+106}, ${b.x} ${b.y+106}`)
    wires.append(path)
  }
  let widest = cols * colWidth + 80
  branches.forEach(branch => {
    const point = branchPositions.get(branch.id)
    if (!point) return
    const { x, y } = point
    const source = positions[branch.sourceTurn - 1]
    if (source) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.classList.add('branch-wire')
      path.setAttribute('d', `M ${source.x+140} ${source.y+212} C ${source.x+140} ${y-55}, ${x+140} ${y-55}, ${x+140} ${y}`)
      wires.append(path)
    }
    const items = [{ prompt:`从第 ${branch.sourceTurn} 轮分支`, answer:branch.title, createdAt:branch.createdAt }, ...branch.messages]
    items.forEach((item, step) => {
      const bx = x + step * colWidth
      widest = Math.max(widest, bx + colWidth)
      const card = template.content.firstElementChild.cloneNode(true)
      card.classList.add('branch-card')
      card.dataset.branch = branch.id
      card.classList.toggle('active', selectedBranchId === branch.id)
      card.style.left = `${bx}px`; card.style.top = `${y}px`
      card.querySelector('.card-date').textContent = `${step ? `分支追问 ${step}` : (branch.mode === 'native' ? '精确分支' : '文本分支')} · ${formatTime(item.createdAt)}`
      card.querySelector('.card-prompt').textContent = item.prompt
      card.querySelector('.card-answer').textContent = item.answer || item.error || (step ? '正在等待回复…' : '点击继续追问')
      card.querySelector('em').textContent = step ? '查看分支对话 ↗' : '继续追问 ↗'
      card.addEventListener('click', event => { event.stopPropagation(); inspectBranch(branch) })
      nodes.append(card)
      if (step) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.classList.add('branch-wire')
        path.setAttribute('d', `M ${bx-colWidth+280} ${y+106} C ${bx-colWidth+310} ${y+106}, ${bx-30} ${y+106}, ${bx} ${y+106}`)
        wires.append(path)
      }
    })
  })
  if (draftTurn && draftPosition) {
    const source = positions[draftTurn.number - 1]
    if (source) {
      const { x, y } = draftPosition
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.classList.add('draft-wire')
      path.setAttribute('d', `M ${source.x+140} ${source.y+212} C ${source.x+140} ${y-12}, ${x+140} ${y-12}, ${x+140} ${y}`)
      wires.append(path)
      const draft = document.createElement('form')
      draft.className = 'branch-draft'
      draft.style.left = `${x}px`; draft.style.top = `${y}px`
      draft.innerHTML = `<strong>从第 ${draftTurn.number} 轮分支</strong><textarea id="draft-input" placeholder="输入这个分支的新问题…" required maxlength="12000"></textarea><p id="draft-error" class="error"></p><div><button type="button" id="draft-cancel">取消</button><button type="submit" id="draft-send">发送并创建分支</button></div>`
      draft.querySelector('#draft-cancel').addEventListener('click', () => { draftTurn = null; renderMap() })
      draft.addEventListener('submit', event => {
        event.preventDefault()
        const prompt = draft.querySelector('#draft-input').value.trim()
        if (prompt) createBranch(draftTurn, prompt)
      })
      nodes.append(draft)
    }
  }
  wires.style.width = `${Math.max(canvas.clientWidth, widest)}px`
  wires.style.height = `${Math.max(canvas.clientHeight, totalRows * 270 + 100)}px`
  transform()
}
function renderList(expandMatches = false) {
  const term = search.value.trim().toLowerCase()
  const matches = sessions.filter(s => !term || `${s.title} ${s.cwd}`.toLowerCase().includes(term))
  const groupsByKey = new Map()
  for (const session of matches) {
    const key = projectKey(session.cwd)
    if (!groupsByKey.has(key)) groupsByKey.set(key, { key, cwd:session.cwd, sessions:[] })
    groupsByKey.get(key).sessions.push(session)
  }
  const groups = [...groupsByKey.values()].sort((a, b) => (a.key === '@unlinked') - (b.key === '@unlinked'))
  if (term) {
    if (expandMatches || !searchOpenProjects) searchOpenProjects = new Set(groups.map(group => group.key))
  } else searchOpenProjects = null
  const expandedProjects = searchOpenProjects ?? openProjects
  list.replaceChildren()
  for (const group of groups) {
    const section = document.createElement('section')
    section.className = 'project-group'
    const heading = document.createElement('button')
    heading.type = 'button'
    heading.className = 'project-heading'
    heading.classList.toggle('has-selected', group.key === projectKey(selectedSession?.cwd))
    heading.title = group.cwd
    const isOpen = expandedProjects.has(group.key)
    heading.setAttribute('aria-expanded', String(isOpen))
    heading.setAttribute('aria-label', `${isOpen ? '收起' : '展开'}项目 ${workspaceName(group.cwd)}，${group.sessions.length} 条会话`)
    heading.innerHTML = `<span class="project-chevron" aria-hidden="true">▸</span><span class="project-label"><strong>${escapeHtml(workspaceName(group.cwd))}</strong><small>${escapeHtml(group.cwd)}</small></span><span class="project-count">${group.sessions.length}</span>`
    const content = document.createElement('div')
    content.className = 'project-sessions'
    content.hidden = !isOpen
    heading.addEventListener('click', () => {
      if (expandedProjects.has(group.key)) expandedProjects.delete(group.key)
      else expandedProjects.add(group.key)
      renderList()
    })
    for (const session of group.sessions) {
      const button = document.createElement('button')
      button.className = 'session-item'
      button.classList.toggle('selected', session.id === selectedSession?.id)
      button.innerHTML = `<strong>${escapeHtml(session.title)}</strong><small>${formatTime(session.updatedAt)}</small>`
      button.addEventListener('click', () => selectSession(session))
      content.append(button)
    }
    section.append(heading, content)
    list.append(section)
  }
  if (!groups.length) {
    const empty = document.createElement('p')
    empty.className = 'list-empty'
    empty.textContent = term ? '没有匹配的项目或会话' : '没有本地会话'
    list.append(empty)
  }
  document.querySelector('#count').textContent = `${groups.length} 组 · ${matches.length} 条`
}
async function selectSession(session) {
  setInspectorOpen(false)
  draftTurn = null
  selectedSession = session
  openProjects.add(projectKey(session.cwd))
  turns = []
  branches = []
  selectedBranchId = null
  selectedTurnNumber = null
  resetCamera()
  renderList()
  renderMap()
  document.querySelector('#session-title').textContent = session.title
  document.querySelector('#session-meta').textContent = `${workspaceName(session.cwd)} · 正在读取对话…`
  inspector.innerHTML = '<p class="eyebrow">TURN DETAIL</p><div class="blank">选择一张对话卡片<br>查看问题和回答全文</div>'
  const request = ++requestNumber
  try {
    const response = await fetch(`/api/session/${encodeURIComponent(session.id)}`)
    if (!response.ok) throw new Error('读取对话失败')
    const data = await response.json()
    if (request !== requestNumber) return
    turns = data.turns
    branches = data.branches || []
    document.querySelector('#session-meta').textContent = `${workspaceName(session.cwd)} · ${turns.length} 轮对话 · ${branches.length} 条分支`
    renderMap()
    for (const branch of branches.filter(item => item.messages.some(message => message.status === 'running'))) pollBranch(branch.id)
  } catch (error) {
    if (request === requestNumber) document.querySelector('#session-meta').textContent = error.message
  }
}
async function load() {
  document.querySelector('#status').textContent = '正在读取本地记录…'
  try {
    const response = await fetch('/api/sessions')
    if (!response.ok) throw new Error('读取会话失败')
    const data = await response.json()
    sessions = data.sessions
    document.querySelector('#updated').textContent = `更新于 ${formatTime(data.updatedAt)}`
    document.querySelector('#status').textContent = '本机 Codex 会话'
    renderList()
    const current = sessions.find(s => s.id === selectedSession?.id) ?? sessions[0]
    if (current) await selectSession(current)
  } catch (error) { document.querySelector('#status').textContent = error.message }
}
search.addEventListener('input', () => renderList(true))
document.querySelector('#reload').addEventListener('click', load)
document.querySelector('#fit').addEventListener('click', resetCamera)
detailsButton.addEventListener('click', () => setInspectorOpen(!shell.classList.contains('inspector-open')))
canvas.addEventListener('wheel', event => {
  event.preventDefault()
  camera.scale = Math.max(.5, Math.min(1.5, camera.scale * (event.deltaY > 0 ? .9 : 1.1)))
  transform()
}, { passive:false })
canvas.addEventListener('pointerdown', event => {
  if (event.target === canvas || event.target === nodes || event.target === wires) {
    dragging = { x:event.clientX, y:event.clientY, cx:camera.x, cy:camera.y }
    canvas.setPointerCapture(event.pointerId)
  }
})
canvas.addEventListener('pointermove', event => {
  if (!dragging) return
  camera.x = dragging.cx + event.clientX - dragging.x
  camera.y = dragging.cy + event.clientY - dragging.y
  transform()
})
canvas.addEventListener('pointerup', () => dragging = null)
window.addEventListener('resize', renderMap)
load()
