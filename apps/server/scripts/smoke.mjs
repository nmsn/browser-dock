/**
 * RPA 契约集成自测（apps/server/README.md 第 7 节第 5 步）
 *
 * 前置：PostgreSQL 可用、迁移已应用（pnpm db:migrate）、服务端已启动。
 * 运行：node scripts/smoke.mjs（BASE 默认 http://127.0.0.1:3100）
 *
 * 覆盖：设备注册 → 管理端录入（房间/计划/配置）→ list → claim（CAS + 重复认领拒绝）
 *       → EXECUTING → FAILED 自动重试（PENDING_PUSH + retryCount）→ 再认领 → DONE
 *       → 迟到写回忽略（终态 CAS）→ LIVE_PLAN DONE liveId 校验 → 执行记录上传
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:3100'

const results = []
function assert(name, ok, extra = '') {
  results.push(Boolean(ok))
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? `  (${extra})` : ''}`)
}

async function api(method, path, { token, body, form, file } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  let payload
  if (form) {
    payload = form
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  let data = null
  const text = await res.text()
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (res.status >= 400) console.log(`  [debug] ${method} ${path} -> ${res.status} ${text.slice(0, 160)}`)
  return { status: res.status, ok: res.ok, data }
}

const unique = Date.now().toString().slice(-10)
const taobaoAccount = `9${unique}` // ≥6 位数字，模拟 userNumId
const deviceId1 = `smoke-device-1-${Date.now()}`
const deviceId2 = `smoke-device-2-${Date.now()}`

// 1. 管理端登录
const login = await api('POST', '/admin/auth/login', {
  body: { username: process.env.ADMIN_USER ?? 'admin', password: process.env.ADMIN_PASSWORD ?? 'admin' }
})
assert('admin login', (login.status === 200 || login.status === 201) && Boolean(login.data.accessToken))
const admin = login.data.accessToken

// 2. 设备注册 ×2
const reg1 = await api('POST', '/rpa/devices/register', { body: { deviceId: deviceId1, name: 'smoke-1' } })
const reg2 = await api('POST', '/rpa/devices/register', { body: { deviceId: deviceId2, name: 'smoke-2' } })
assert(
  'device register ×2',
  (reg1.status === 200 || reg1.status === 201) &&
    Boolean(reg1.data.deviceToken) &&
    Boolean(reg2.data.deviceToken)
)
const dev1 = reg1.data.deviceToken
const dev2 = reg2.data.deviceToken

// 无凭证访问应 401
const anon = await api('POST', '/rpa/task/list', { body: { taobaoAccount } })
assert('rpa requires device token', anon.status === 401)

// 3. 录入房间 / 计划 / 配置
const room = await api('POST', '/admin/rooms', {
  token: admin,
  body: { taobaoAccountId: taobaoAccount, roomName: `smoke-room-${unique}` }
})
assert('room created', room.ok && Boolean(room.data.id))

const plan = await api('POST', '/admin/plans', {
  token: admin,
  body: {
    roomId: room.data.id,
    liveDate: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10),
    liveTitle: 'smoke 直播间',
    scheduledTriggerTime: new Date().toISOString()
  }
})
assert('plan created', plan.ok && plan.data.planStatus === 'PENDING_CREATE')

const config = await api('POST', `/admin/plans/${plan.data.id}/configs`, {
  token: admin,
  body: { configType: 'HOT_ITEM_TOP', configData: { hotItemSlotIds: '8152947823\n7001002' }, scheduledTriggerTime: new Date().toISOString() }
})
assert('config created', config.ok && config.data.configStatus === 'PENDING_PUSH')

// 非法配置应 400
const badConfig = await api('POST', `/admin/plans/${plan.data.id}/configs`, {
  token: admin,
  body: { configType: 'HOT_ITEM_TOP', configData: { hotItemSlotIds: '1\n2\n3\n4' } }
})
assert('config hotItemSlotIds >3 rejected', badConfig.status === 400)

// 4. list
const list = await api('POST', '/rpa/task/list', { token: dev1, body: { taobaoAccount } })
const listPlan = list.data?.[0]?.plans?.[0]
assert(
  'task/list returns plan with config',
  list.ok && listPlan?.id === plan.data.id && listPlan.configList?.length === 1,
  JSON.stringify(list.data)?.slice(0, 200)
)

// 5. claim：设备1 认领配置成功；设备2 认领同一配置被拒
const claim1 = await api('POST', '/rpa/task/claim', {
  token: dev1,
  body: { taobaoAccount, deviceId: deviceId1, pluginVersion: 'smoke', tasks: [{ taskType: 'LIVE_PLAN_CONFIG', taskId: config.data.id }] }
})
assert('claim by device1 ok', claim1.ok && claim1.data.claimed.length === 1)
const claim2 = await api('POST', '/rpa/task/claim', {
  token: dev2,
  body: { taobaoAccount, deviceId: deviceId2, pluginVersion: 'smoke', tasks: [{ taskType: 'LIVE_PLAN_CONFIG', taskId: config.data.id }] }
})
assert('claim by device2 rejected (已被其他设备认领)', claim2.data.rejected?.[0]?.reason === '已被其他设备认领')

// 6. EXECUTING（设备2 冒充应 403）
const exec2 = await api('POST', '/rpa/task/report', {
  token: dev2,
  body: { taobaoAccount, taskType: 'LIVE_PLAN_CONFIG', taskId: config.data.id, status: 'EXECUTING' }
})
assert('report EXECUTING from other device rejected', exec2.status === 403, `got ${exec2.status}`)
const exec1 = await api('POST', '/rpa/task/report', {
  token: dev1,
  body: { taobaoAccount, taskType: 'LIVE_PLAN_CONFIG', taskId: config.data.id, status: 'EXECUTING' }
})
assert('report EXECUTING ok', exec1.ok && exec1.data.accepted === true)

// 7. FAILED → 自动重试（PENDING_PUSH + retryCount 1）
const failed = await api('POST', '/rpa/task/report', {
  token: dev1,
  body: { taobaoAccount, taskType: 'LIVE_PLAN_CONFIG', taskId: config.data.id, status: 'FAILED', failReason: 'smoke 注入失败' }
})
assert('report FAILED accepted', failed.data.accepted === true)
const list2 = await api('POST', '/rpa/task/list', { token: dev1, body: { taobaoAccount } })
const cfg2 = list2.data?.[0]?.plans?.[0]?.configList?.[0]
assert('auto-retry reset PENDING_PUSH + retryCount=1', cfg2?.configStatus === 'PENDING_PUSH' && cfg2?.retryCount === 1)

// 8. 自愈重领 + DONE
const reclaim = await api('POST', '/rpa/task/claim', {
  token: dev1,
  body: { taobaoAccount, deviceId: deviceId1, pluginVersion: 'smoke', tasks: [{ taskType: 'LIVE_PLAN_CONFIG', taskId: config.data.id }] }
})
assert('self-heal re-claim ok', reclaim.data?.claimed?.length === 1)
const execAgain = await api('POST', '/rpa/task/report', {
  token: dev1,
  body: { taobaoAccount, taskType: 'LIVE_PLAN_CONFIG', taskId: config.data.id, status: 'EXECUTING' }
})
const done = await api('POST', '/rpa/task/report', {
  token: dev1,
  body: { taobaoAccount, taskType: 'LIVE_PLAN_CONFIG', taskId: config.data.id, status: 'DONE', executionResult: '已置顶 2 个商品' }
})
assert('report DONE accepted', done.data.accepted === true)

// 9. 终态 CAS：DONE 后再报 FAILED 应忽略（accepted=false）
const late = await api('POST', '/rpa/task/report', {
  token: dev1,
  body: { taobaoAccount, taskType: 'LIVE_PLAN_CONFIG', taskId: config.data.id, status: 'FAILED', failReason: 'late' }
})
assert('late report ignored (terminal CAS)', late.data.accepted === false)

// 10. LIVE_PLAN DONE liveId 校验
await api('POST', '/rpa/task/claim', {
  token: dev1,
  body: { taobaoAccount, deviceId: deviceId1, pluginVersion: 'smoke', tasks: [{ taskType: 'LIVE_PLAN', taskId: plan.data.id }] }
})
const planDoneNoLive = await api('POST', '/rpa/task/report', {
  token: dev1,
  body: { taobaoAccount, taskType: 'LIVE_PLAN', taskId: plan.data.id, status: 'DONE' }
})
assert('plan DONE without liveId rejected', planDoneNoLive.status === 403, `got ${planDoneNoLive.status}`)
const planDone = await api('POST', '/rpa/task/report', {
  token: dev1,
  body: { taobaoAccount, taskType: 'LIVE_PLAN', taskId: plan.data.id, status: 'DONE', liveId: '260000000000999' }
})
assert('plan DONE with liveId accepted', planDone.data.accepted === true)

// 11. 执行记录上传（multipart + 截图）
const form = new FormData()
form.append(
  'record',
  JSON.stringify({ taobaoAccountId: taobaoAccount, planId: plan.data.id, configId: config.data.id, configType: 'HOT_ITEM_TOP', status: 'FAILED', failReason: 'smoke 截图', result: { ok: false } })
)
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')
form.append('failureScreenshot', new Blob([png], { type: 'image/png' }), 'fail.png')
const upload = await api('POST', '/rpa/execution-records', { token: dev1, form })
assert('execution-record uploaded', upload.ok && Boolean(upload.data.id))

// 结果
const pass = results.every(Boolean)
console.log(pass ? '\nPASS: rpa contract smoke passed' : '\nFAIL: see assertions above')
process.exit(pass ? 0 : 1)
