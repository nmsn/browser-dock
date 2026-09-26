/**
 * C32 爆品置顶 全链路 fixture 验证（ADR-0006，无登录态环境）
 *
 * 本地 HTTP 服务模拟淘宝直播中控台 DOM（选择器与生产验证过的扩展代码同源）：
 * - /live/list            直播计划页（按 ID 搜索、状态下拉、「直播详情」行）
 * - /live/control?liveId= 直播详情页（头部状态、口袋商品 Tab、维度下拉、
 *                          商品 ID 搜索、置顶/取消图标、三类弹窗状态机）
 *
 * 以 BROWSER_DOCK_C32_FIXTURE=1 启动 Electron（真实嵌入式执行宿主：离屏账号视图、
 * page-script 注入、主进程编排），断言完整流程：
 * 列表搜索 → 进详情（window.open 捕获）→ 已置顶跳过 → 逐商品置顶
 * → 替换上限弹窗（B）→ 清空搜索 → 回列表恢复筛选。
 *
 * 运行：pnpm test:c32-fixture
 */
import { spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'http'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const ROOM_ID = '260000000000001'
// 7001001 已置顶（跳过）；7001004/7001005 预置爆品使爆品数=3，
// 置顶 7001002/7001003 时必然触发「替换上限」弹窗（B）→ 点确定替换最后一个
const PRODUCT_IDS = ['7001001', '7001002', '7001003']
const PRE_PINNED = ['7001001', '7001004', '7001005']

// ---------------- fixture 状态与服务 ----------------
/** 商品清单：id → { pinned }（服务端内存状态，跨请求持久；pinned 统一由 PRE_PINNED 派生） */
const products = [
  { id: '7001001', name: '测试商品甲' },
  { id: '7001002', name: '测试商品乙' },
  { id: '7001003', name: '测试商品丙' },
  { id: '7001004', name: '测试商品丁' },
  { id: '7001005', name: '测试商品戊' }
].map((p) => ({ ...p, pinned: PRE_PINNED.includes(p.id) }))
let stateVersion = 0

const listHtml = `<!doctype html><html><head><title>直播计划</title></head><body>
<div class="sidebar"><span>直播</span><span>直播计划</span></div>
<div class="toolbar">
  <input id="idSearch" placeholder="输入ID或标题筛选" />
  <div class="tbd-select" id="statusSelect">
    <div class="tbd-select-selector"><span class="tbd-select-selection-item" title="全部">全部</span></div>
  </div>
  <span>列表模式</span>
</div>
<ul id="rows"></ul>
<div class="tbd-select-dropdown" style="display:none">
  <div class="tbd-select-item-option" title="全部">全部</div>
  <div class="tbd-select-item-option" title="未开播">未开播</div>
  <div class="tbd-select-item-option" title="直播中">直播中</div>
  <div class="tbd-select-item-option" title="已开播">已开播</div>
</div>
<script>
  const ROOM_ID = ${JSON.stringify(ROOM_ID)}
  const rows = document.getElementById('rows')
  function render() {
    const q = document.getElementById('idSearch').value.trim()
    const ids = [ROOM_ID, '260000000000099']
    rows.innerHTML = ids.map((id) =>
      '<li class="row" data-room="' + id + '"><span>场次 ' + id + '</span>' +
      '<span>状态：直播中</span>' +
      '<button data-tblalog-id="zhiBoXiangQing">直播详情</button></li>'
    ).join('')
    Array.from(rows.children).forEach((li) => {
      const id = li.getAttribute('data-room')
      li.querySelector('button').addEventListener('click', () => {
        window.open('/live/control?liveId=' + id)
      })
      if (q && !li.textContent.includes(q)) li.style.display = 'none'
    })
  }
  let timer
  document.getElementById('idSearch').addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(render, 300)
  })
  render()
</script>
</body></html>`

const detailHtml = `<!doctype html><html><head><title>直播详情</title></head><body>
<div class="tdp-header"><h1>测试直播间</h1>
  <span class="tdp-header-subtitle">直播中·0小时5分钟</span></div>
<nav class="tabs-header">
  <div class="tabs-header-item tabs-header-item--commodity active"><span>商品</span></div>
  <div class="tabs-header-item tabs-header-item--pocket"><span>口袋商品</span></div>
</nav>
<section id="commodityPanel"><p>全部商品（非口袋）</p></section>
<section id="pocketPanel" style="display:none">
  <div class="tbla-input-group-wrapper">
    <div class="tbla-select search-select--mode" id="modeSelect">
      <div class="tbla-select-selector">
        <span class="tbla-select-selection-item" id="modeDisplay" title="商品标题">商品标题</span>
      </div>
    </div>
    <input id="productSearch" placeholder="输入对应内容搜索" />
  </div>
  <div id="livePushed"><div class="list" id="productList"></div></div>
</section>
<div class="tbla-select-dropdown" id="modeDropdown" style="display:none">
  <div class="tbla-select-item-option tbla-select-item-option-state" title="商品标题">商品标题</div>
  <div class="tbla-select-item-option" title="商品ID">商品ID</div>
</div>
<script>
  const state = ${JSON.stringify({ products, version: 0 })}
  state.products = ${JSON.stringify(products)}
  function renderProducts() {
    const list = document.getElementById('productList')
    const q = (document.getElementById('productSearch')?.value ?? '').trim()
    list.innerHTML = ''
    for (const p of state.products) {
      if (q && !p.id.includes(q)) continue
      const card = document.createElement('div')
      card.className = 'product-card'
      card.setAttribute('data-item-id', p.id)
      card.innerHTML = '<span class="name">' + p.name + '</span>' +
        (p.pinned
          ? '<span data-tblalog-id="ItemTopAction__quXiaoZhiDing" class="pin-icon">取消置顶</span>'
          : '<span data-tblalog-id="ItemTopAction__baopinzhiding" class="pin-icon">置顶</span>')
      list.appendChild(card)
    }
  }
  function showModal(text) {
    const wrap = document.createElement('div')
    wrap.className = 'tbla-modal'
    wrap.innerHTML = '<div class="tbla-modal-content">' +
      '<p>' + text + '</p>' +
      '<button class="modal-cancel">取 消</button>' +
      '<button class="modal-ok">确 定</button></div>'
    document.body.appendChild(wrap)
    return wrap
  }
  function bindPin(card) {
    const pin = card.querySelector('[data-tblalog-id="ItemTopAction__baopinzhiding"]')
    if (!pin) return
    pin.addEventListener('click', () => {
      const pinnedCount = state.products.filter((p) => p.pinned).length
      const target = state.products.find((p) => p.id === card.getAttribute('data-item-id'))
      if (!target || target.pinned) return
      if (pinnedCount >= 3) {
        const wrap = showModal('爆品最多置顶3个，继续操作，将替换当前置顶中的最后一个商品')
        wrap.querySelector('.modal-ok').addEventListener('click', () => {
          const last = state.products.filter((p) => p.pinned).pop()
          if (last) last.pinned = false
          target.pinned = true
          wrap.remove()
          renderProducts()
        })
      } else {
        const wrap = showModal('确定要设置' + target.id + '号宝贝为爆品宝贝吗？')
        wrap.querySelector('.modal-ok').addEventListener('click', () => {
          setTimeout(() => {
            target.pinned = true
            wrap.remove()
            renderProducts()
          }, 500)
        })
      }
    })
  }
  const listEl = document.getElementById('productList')
  const observer = new MutationObserver(() => {
    Array.from(listEl.querySelectorAll('[data-item-id]')).forEach(bindPin)
  })
  observer.observe(listEl, { childList: true, subtree: true })

  document.querySelector('.tabs-header-item--pocket').addEventListener('click', () => {
    document.querySelector('.tabs-header-item--commodity').classList.remove('active')
    document.querySelector('.tabs-header-item--pocket').classList.add('active')
    document.getElementById('commodityPanel').style.display = 'none'
    document.getElementById('pocketPanel').style.display = 'block'
    renderProducts()
  })
  const modeSelect = document.getElementById('modeSelect')
  const dropdown = document.getElementById('modeDropdown')
  modeSelect.querySelector('.tbla-select-selector').addEventListener('mousedown', () => {
    dropdown.style.display = 'block'
  })
  Array.from(dropdown.querySelectorAll('.tbla-select-item-option')).forEach((opt) => {
    opt.addEventListener('mousedown', () => {
      document.getElementById('modeDisplay').textContent = opt.getAttribute('title')
      document.getElementById('modeDisplay').setAttribute('title', opt.getAttribute('title'))
      dropdown.style.display = 'none'
      renderProducts()
    })
  })
  let searchTimer
  document.getElementById('productSearch').addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(renderProducts, 300)
  })
</script>
</body></html>`

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  if (url.pathname === '/live/list') return res.end(listHtml)
  if (url.pathname === '/live/control' && url.searchParams.get('liveId')) return res.end(detailHtml)
  res.end('not found')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
console.log(`fixture server: ${base}`)

// ---------------- 启动 Electron（真实嵌入式执行宿主）----------------
const child = spawn('./node_modules/.bin/electron', ['.'], {
  cwd: root,
  env: {
    ...process.env,
    BROWSER_DOCK_C32_FIXTURE: '1',
    BROWSER_DOCK_FIXTURE_BASE: base,
    C32_FIXTURE_ROOM_ID: ROOM_ID,
    C32_FIXTURE_PRODUCT_IDS: PRODUCT_IDS.join(',')
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let output = ''
child.stdout.on('data', (d) => {
  output += d.toString()
  process.stdout.write(d)
})
child.stderr.on('data', (d) => {
  process.stderr.write(d)
})

const timeout = setTimeout(() => {
  console.error('\nFAIL: c32 fixture test timed out (150s)')
  child.kill('SIGKILL')
}, 150_000)

child.on('exit', () => {
  clearTimeout(timeout)
  const pass = output.includes('"pass":true') && output.includes('PASS: c32 fixture test passed')
  const asserts = [
    ['execution success', output.includes('status=success')],
    ['all products pinned (incl. already-pinned skip)', /已置顶 3 个商品为爆品|已置顶 3 个商品/.test(output)],
    ['replace-limit dialog (B) handled', output.includes('已达爆品上限3个')],
    ['search cleared (list restored)', output.includes('已清空商品 ID 搜索')],
    ['list filters reset after run', output.includes('已恢复列表默认筛选')]
  ]
  console.log('')
  let allOk = pass
  for (const [name, ok] of asserts) {
    console.log(`${ok ? '✓' : '✗'} ${name}`)
    allOk = allOk && ok
  }
  console.log(allOk ? 'PASS: c32 fixture pipeline passed' : 'FAIL: see assertions above')
  server.close()
  process.exit(allOk ? 0 : 1)
})
