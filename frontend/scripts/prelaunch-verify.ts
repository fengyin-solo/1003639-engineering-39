// 临时验证脚本：在 node 里模拟 localStorage，跑真实的演练/检查服务逻辑。
// 用法：esbuild 打包后 node 执行，验证完成后删除。
const store = new Map<string, string>()

// @ts-expect-error 模拟浏览器环境
globalThis.window = {
  localStorage: {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
}

import { MODULES } from '@/data/modules'
import { allRows, listRows, saveRows, storageKey } from '@/data/local-store'
import { loadPrelaunchState, resetPrelaunchProgress, savePrelaunchState } from '@/data/prelaunch-store'
import {
  listDisposalReminders,
  listSupplyWarnings,
  runDrill,
  runPrelaunchCheck,
} from '@/api/prelaunch-service'
import { runAction } from '@/api/local-service'

let failures = 0
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  ok  ${label}`)
  } else {
    failures += 1
    console.log(`FAIL  ${label}`)
  }
}

// ---- 1. 首次演练：台账非空（自动播种），决策应为保留 ----
console.log('1. 首次演练（台账已有示例数据）')
let result = runDrill()
assert(result.reports.length === 3, '三个环节依次执行')
assert(result.state.ledgerDecision === 'keep', '台账不为空时选择保留')
assert(result.state.snapshots.length === 1, '生成 1 份交接快照')
const snap1 = JSON.stringify(result.state.snapshots[0])
assert(result.state.steps.ledger.done && result.state.steps.verify.done && result.state.steps.snapshot.done, '全部环节完成')

// ---- 2. 连续执行两次：不产生重复事项 ----
console.log('2. 连续再跑两次演练')
result = runDrill()
assert(result.reports.length === 0, '第二次执行没有待执行环节')
result = runDrill()
assert(result.state.snapshots.length === 1, '快照没有重复生成')

// ---- 3. 重置进度后再跑：数据未变，沿用最近快照 ----
console.log('3. 重置进度后再演练')
resetPrelaunchProgress()
result = runDrill()
assert(result.reports.length === 3, '重置后三个环节重新执行')
assert(result.state.snapshots.length === 1, '数据未变化时不新增快照')
assert(JSON.stringify(result.state.snapshots[0]) === snap1, '历史快照内容保持原样')

// ---- 4. 数据变化后再演练：追加新快照，旧快照不动 ----
console.log('4. 业务数据变化后再演练')
runAction('patrol', 1, '取消任务')
resetPrelaunchProgress()
result = runDrill()
assert(result.state.snapshots.length === 2, '追加第 2 份快照')
assert(JSON.stringify(result.state.snapshots[0]) === snap1, '旧快照未被新样例覆盖')
assert(result.state.snapshots[1].id === 'SNAP-0002', '新快照编号递增')

// ---- 5. 上线前检查：三处同源 + 发布核查登记 ----
console.log('5. 上线前检查')
const pendingBefore = listDisposalReminders().length
let check = runPrelaunchCheck()
assert(check.reports.length === 4, '四个检查项依次执行')
assert(check.reports.every((r) => r.ok), '概览汇总/处置提醒/物资预警同源校验通过')
assert(check.state.releaseItems.length === pendingBefore, '跨模块处置提醒全部登记进发布核查')
const fp = check.state.checks.overview.detail.match(/数据指纹 ([0-9a-f]+)/)?.[1]
assert(!!fp && check.state.checks.reminders.detail.includes(fp!) && check.state.checks.supply.detail.includes(fp!), '三处读到同一份数据（指纹一致）')

// ---- 6. 检查重复执行：不产生重复事项 ----
console.log('6. 重复执行检查')
check = runPrelaunchCheck()
assert(check.reports.length === 0, '第二次检查没有待执行项')
assert(check.state.releaseItems.length === pendingBefore, '发布核查清单没有重复登记')

// ---- 7. 中断后从缺失环节继续 ----
console.log('7. 模拟中断后续跑')
resetPrelaunchProgress()
const state = loadPrelaunchState()
state.steps.ledger = { done: true, doneAt: '2026-10-04 08:00:00', detail: '上次演练已完成' }
state.checks.overview = { done: true, doneAt: '2026-10-04 08:00:00', detail: '上次检查已完成' }
// 手动落盘模拟“上次跑到一半”
savePrelaunchState(state)
result = runDrill()
assert(result.reports.length === 2 && result.reports[0].key === 'verify', '演练从缺失的 verify 环节继续')
check = runPrelaunchCheck()
assert(check.reports.length === 3 && check.reports[0].key === 'reminders', '检查从缺失的 reminders 项继续')

// ---- 8. 台账为空时用示例数据重建，快照不受影响 ----
console.log('8. 空台账重建 + 快照隔离')
for (const meta of MODULES) {
  saveRows(meta.key, [])
}
resetPrelaunchProgress()
result = runDrill()
assert(result.state.ledgerDecision === 'rebuild', '台账为空时选择重建')
assert(listRows('patrol').length === 3, '示例数据重新播种')
assert(result.state.snapshots.length === 3, '重建后数据变化，追加第 3 份快照')
assert(JSON.stringify(result.state.snapshots[0]) === snap1, '最早的历史快照仍然原样')

// ---- 9. 重播种业务数据碰不到演练存储 ----
console.log('9. 业务台账与演练存储隔离')
store.delete(storageKey())
assert(allRows()['patrol'].length === 3, '清掉 entries 后自动回示例数据')
assert(loadPrelaunchState().snapshots.length === 3, '历史交接快照保持原样')

// ---- 10. 物资预警口径 ----
console.log('10. 物资预警')
const warnings = listSupplyWarnings()
assert(warnings.length === 2, `物资预警 2 条（偏低/需补充），实际 ${warnings.length}`)

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
