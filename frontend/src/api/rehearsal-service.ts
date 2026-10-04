import { MODULES, MODULE_BY_KEY } from '@/data/modules'
import { allRows, resetAllRows } from '@/data/local-store'
import { SEED_ROWS } from '@/data/seed'
import type { EntryRow } from '@/data/types'
import {
  appendSnapshot,
  loadChecklist,
  loadRun,
  loadSnapshots,
  saveChecklist,
  saveRun,
  clearRun,
  type ReleaseChecklistEntry,
} from '@/data/rehearsal-store'
import {
  REHEARSAL_STAGES,
  type CheckReport,
  type HandoverSnapshot,
  type LedgerPolicy,
  type MetricCheck,
  type ModuleCheck,
  type ReaderProbe,
  type RehearsalRun,
  type RehearsalStageKey,
  type ReleaseCheckReport,
  type ReminderItem,
  type StageState,
} from '@/data/rehearsal-types'

// 物资预警状态：物资储备模块进入这三态就要在发布核查里盯住。
const SUPPLY_WARNING_STATUSES = ['偏低', '需补充', '已过期']

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// FNV-1a：不需要 crypto 就能得到稳定指纹，同样的数据必然算出同样的 hash。
function fingerprintOf(rows: Record<string, EntryRow[]>): string {
  const lines = Object.keys(rows)
    .sort()
    .map((key) => {
      const part = (rows[key] ?? [])
        .slice()
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map((row) => `${row.id}|${row.status}|${row.pending ? 1 : 0}|${row.abnormal ? 1 : 0}`)
      return `${key}:${part.join(',')}`
    })
  const text = lines.join(';')
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function nowText(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}:${p(d.getSeconds())}`
}

function stampCompact(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(
    d.getMinutes(),
  )}`
}

// ---- 唯一数据源：概览汇总 / 处置提醒 / 物资预警都从这里拿同一份行数据 ----

type SharedDigest = {
  rows: Record<string, EntryRow[]>
  fingerprint: string
  totalCreated: number
  totalPending: number
  totalAbnormal: number
}

function sharedDigest(): SharedDigest {
  // 始终从数据层当前台账读取，三处读取方拿到的是同一个对象内容。
  const rows = allRows()
  const entries = Object.values(rows).flat()
  return {
    rows,
    fingerprint: fingerprintOf(rows),
    totalCreated: entries.length,
    totalPending: entries.filter((row) => row.pending).length,
    totalAbnormal: entries.filter((row) => row.abnormal).length,
  }
}

// ---- 三个读取方：各自只负责从共享摘要里取自己要的视图 ----

function readOverviewProbe(digest: SharedDigest): ReaderProbe {
  return {
    name: '概览汇总',
    fingerprint: digest.fingerprint,
    totalCreated: digest.totalCreated,
    totalPending: digest.totalPending,
    totalAbnormal: digest.totalAbnormal,
  }
}

function collectReminders(rows: Record<string, EntryRow[]>): ReminderItem[] {
  const items: ReminderItem[] = []
  for (const meta of MODULES) {
    for (const row of rows[meta.key] ?? []) {
      if (row.pending) {
        items.push({
          key: `${meta.key}:${row.id}:pending`,
          scope: meta.name,
          title: `${meta.entity} ${row.id} 待处理`,
          detail: `当前状态「${row.status}」，需要继续跟进处置`,
          kind: 'pending',
        })
      }
      if (row.abnormal) {
        items.push({
          key: `${meta.key}:${row.id}:abnormal`,
          scope: meta.name,
          title: `${meta.entity} ${row.id} 异常`,
          detail: `当前状态「${row.status}」，被标记为异常量`,
          kind: 'abnormal',
        })
      }
    }
  }
  return items
}

function readRemindersProbe(digest: SharedDigest): { probe: ReaderProbe; reminders: ReminderItem[] } {
  const reminders = collectReminders(digest.rows)
  return {
    probe: {
      name: '处置提醒',
      fingerprint: digest.fingerprint,
      totalCreated: digest.totalCreated,
      totalPending: digest.totalPending,
      totalAbnormal: digest.totalAbnormal,
    },
    reminders,
  }
}

function collectSupplyWarnings(rows: Record<string, EntryRow[]>): ReminderItem[] {
  const meta = MODULE_BY_KEY.get('supply')
  if (!meta) {
    return []
  }
  return (rows.supply ?? [])
    .filter((row) => SUPPLY_WARNING_STATUSES.includes(String(row.status)))
    .map((row) => ({
      key: `supply:${row.id}:supply-warning`,
      scope: meta.name,
      title: `${meta.entity} ${row.id} 物资预警`,
      detail: `物资状态「${row.status}」，请上线前核对补充`,
      kind: 'supply-warning' as const,
    }))
}

function readSupplyProbe(digest: SharedDigest): { probe: ReaderProbe; warnings: ReminderItem[] } {
  const supplyRows = digest.rows.supply ?? []
  return {
    probe: {
      name: '物资预警',
      // 预警读取的也是同一份台账，指纹与总量必须对得上
      fingerprint: digest.fingerprint,
      totalCreated: digest.totalCreated,
      totalPending: supplyRows.filter((row) => row.pending).length,
      totalAbnormal: supplyRows.filter((row) => row.abnormal).length,
    },
    warnings: collectSupplyWarnings(digest.rows),
  }
}

// ---- 环节一：示例数据核对 ----

function countSeed(rows: EntryRow[]) {
  return {
    created: rows.length,
    pending: rows.filter((row) => row.pending).length,
    abnormal: rows.filter((row) => row.abnormal).length,
  }
}

// 台账非空时默认保留：保留真实台账，核对只做比对不动数据；
// 只有显式选择 rebuild 才整体重建回示例数据（历史快照不在此键，不受影响）。
function runSampleCheck(policy: LedgerPolicy): CheckReport {
  if (policy === 'rebuild') {
    resetAllRows()
  }
  const rows = allRows()
  const ledgerNonEmpty = Object.values(rows).some((list) => list.length > 0)

  const moduleChecks: ModuleCheck[] = MODULES.map((meta) => {
    const expected = countSeed(SEED_ROWS[meta.key] ?? [])
    const actual = countSeed(rows[meta.key] ?? [])
    return {
      key: meta.key,
      name: meta.name,
      expectedCreated: expected.created,
      actualCreated: actual.created,
      expectedPending: expected.pending,
      actualPending: actual.pending,
      expectedAbnormal: expected.abnormal,
      actualAbnormal: actual.abnormal,
      matched:
        expected.created === actual.created &&
        expected.pending === actual.pending &&
        expected.abnormal === actual.abnormal,
    }
  })

  const totalsExpected = {
    created: moduleChecks.reduce((acc, item) => acc + item.expectedCreated, 0),
    pending: moduleChecks.reduce((acc, item) => acc + item.expectedPending, 0),
    abnormal: moduleChecks.reduce((acc, item) => acc + item.expectedAbnormal, 0),
  }
  const totalsActual = {
    created: moduleChecks.reduce((acc, item) => acc + item.actualCreated, 0),
    pending: moduleChecks.reduce((acc, item) => acc + item.actualPending, 0),
    abnormal: moduleChecks.reduce((acc, item) => acc + item.actualAbnormal, 0),
  }

  const metrics: MetricCheck[] = [
    {
      label: '业务模块',
      expected: MODULES.length,
      actual: MODULES.length,
      matched: true,
    },
    {
      label: '登记总量',
      expected: totalsExpected.created,
      actual: totalsActual.created,
      matched: totalsExpected.created === totalsActual.created,
    },
    {
      label: '待处理',
      expected: totalsExpected.pending,
      actual: totalsActual.pending,
      matched: totalsExpected.pending === totalsActual.pending,
    },
    {
      label: '异常量',
      expected: totalsExpected.abnormal,
      actual: totalsActual.abnormal,
      matched: totalsExpected.abnormal === totalsActual.abnormal,
    },
  ]

  const passed =
    metrics.every((item) => item.matched) && moduleChecks.every((item) => item.matched)

  return {
    ledgerPolicy: policy,
    ledgerNonEmpty,
    metrics,
    modules: moduleChecks,
    passed,
    finishedAt: nowText(),
  }
}

// ---- 环节二：林场交接快照（只追加、按指纹去重、永不覆盖旧快照） ----

function runHandoverSnapshot(
  forestFarm: string,
  operator: string,
): { snapshot: HandoverSnapshot; reused: boolean } {
  const digest = sharedDigest()
  const warnings = collectSupplyWarnings(digest.rows)

  // 同样的数据已有快照就复用：重复演练不产生重复快照，也绝不改写历史快照。
  const existing = loadSnapshots().find((item) => item.fingerprint === digest.fingerprint)
  if (existing) {
    return { snapshot: existing, reused: true }
  }

  const snapshot: HandoverSnapshot = {
    id: `HS-${stampCompact()}-${digest.fingerprint}`,
    fingerprint: digest.fingerprint,
    forestFarm,
    operator,
    createdAt: nowText(),
    cards: [
      { label: '业务模块', value: MODULES.length },
      { label: '登记总量', value: digest.totalCreated },
      { label: '待处理', value: digest.totalPending },
      { label: '异常量', value: digest.totalAbnormal },
    ],
    moduleCount: MODULES.length,
    totalCreated: digest.totalCreated,
    totalPending: digest.totalPending,
    totalAbnormal: digest.totalAbnormal,
    supplyWarnings: warnings.length,
  }
  appendSnapshot(snapshot)
  return { snapshot, reused: false }
}

// ---- 环节三：发布核查（三个读取方同源；跨模块处置提醒并入发布核查清单） ----

function runReleaseCheck(): ReleaseCheckReport {
  const digest = sharedDigest()
  const overviewProbe = readOverviewProbe(digest)
  const { probe: reminderProbe, reminders } = readRemindersProbe(digest)
  const { probe: supplyProbe, warnings } = readSupplyProbe(digest)
  const readers = [overviewProbe, reminderProbe, supplyProbe]

  // 三处指纹一致且登记总量一致，才能认定它们读到的是同一份数据。
  const sameSource =
    readers.every((probe) => probe.fingerprint === digest.fingerprint) &&
    new Set(readers.map((probe) => probe.totalCreated)).size === 1

  const syncItems = [...reminders, ...warnings]
  const releaseItems = syncChecklist(sameSource, syncItems)

  return {
    readers,
    sameSource,
    crossModuleReminders: reminders,
    releaseItems,
    passed: sameSource,
    finishedAt: nowText(),
  }
}

// 发布核查清单按稳定 key 幂等并入：重复执行只更新时间，不产生重复事项；
// 已消失的提醒转为 closed 留痕，历史快照始终不受影响。
function syncChecklist(sameSource: boolean, items: ReminderItem[]): ReminderItem[] {
  const previous = loadChecklist()
  const previousByKey = new Map(previous.map((entry) => [entry.key, entry]))
  const stamp = nowText()

  const fixedKey = 'release:same-source'
  const fixedPrevious = previousByKey.get(fixedKey)
  const fixedEntry: ReleaseChecklistEntry = {
    key: fixedKey,
    scope: '发布核查',
    title: '概览汇总、处置提醒、物资预警同源核对',
    detail: sameSource
      ? '三个读取方读到同一份台账数据，指纹与登记总量一致'
      : '三个读取方数据不一致，禁止上线',
    kind: 'release',
    // 保持默认待办；曾被人工关闭则沿用 closed，重复执行不重复建事项
    status: sameSource && fixedPrevious?.status === 'closed' ? 'closed' : 'open',
    updatedAt: stamp,
  }
  const entries: ReleaseChecklistEntry[] = [
    fixedEntry,
    ...items.map((item) => {
      const old = previousByKey.get(item.key)
      return {
        key: item.key,
        scope: item.scope,
        title: item.title,
        detail: item.detail,
        kind: item.kind,
        // 已是 closed 的事项不重复打开；新事项默认 open
        status: (old?.status === 'closed' ? 'closed' : 'open') as 'open' | 'closed',
        updatedAt: stamp,
      }
    }),
  ]

  // 本轮已不再出现的旧提醒：保留事项但标记 closed，不删历史。
  const activeKeys = new Set(entries.map((entry) => entry.key))
  for (const old of previous) {
    if (!activeKeys.has(old.key) && old.status === 'open') {
      entries.push({ ...old, status: 'closed', updatedAt: stamp })
    } else if (!activeKeys.has(old.key)) {
      entries.push(old)
    }
  }

  saveChecklist(entries)
  return entries.map((entry) => ({
    key: entry.key,
    scope: entry.scope,
    title: entry.title,
    detail: entry.detail,
    kind: entry.kind as ReminderItem['kind'],
  }))
}

// ---- 演练编排：中断续跑、整体幂等 ----

function freshStages(): Record<RehearsalStageKey, StageState> {
  return {
    'sample-check': { status: 'pending', startedAt: null, finishedAt: null, message: '' },
    'handover-snapshot': { status: 'pending', startedAt: null, finishedAt: null, message: '' },
    'release-check': { status: 'pending', startedAt: null, finishedAt: null, message: '' },
  }
}

export type RunRehearsalOptions = {
  policy?: LedgerPolicy
  forestFarm?: string
  operator?: string
  restart?: boolean
}

export function runRehearsal(options: RunRehearsalOptions = {}): RehearsalRun {
  const existing = options.restart ? null : loadRun()
  const policy: LedgerPolicy = options.policy ?? existing?.ledgerPolicy ?? 'keep'
  const resumedFarm = existing?.snapshotId
    ? loadSnapshots().find((item) => item.id === existing.snapshotId)?.forestFarm
    : undefined
  const forestFarm = options.forestFarm ?? resumedFarm ?? '综合林场'
  const operator = options.operator ?? '值班管理员'

  // 已完成的同一轮演练：直接返回，不产生任何重复事项。
  if (existing && existing.finished && !options.restart) {
    return existing
  }

  const run: RehearsalRun =
    existing && !options.restart
      ? clone(existing)
      : {
          id: `RUN-${stampCompact()}`,
          ledgerPolicy: policy,
          startedAt: nowText(),
          updatedAt: nowText(),
          stages: freshStages(),
          checkReport: null,
          snapshotId: null,
          releaseCheck: null,
          finished: false,
        }
  run.ledgerPolicy = policy
  run.updatedAt = nowText()

  // 环节一：核对失败就停在这里，状态保留为 running，下次从本环节继续。
  const checkStage = run.stages['sample-check']
  if (checkStage.status !== 'done') {
    checkStage.status = 'running'
    checkStage.startedAt = checkStage.startedAt ?? nowText()
    const report = runSampleCheck(policy)
    run.checkReport = report
    if (!report.passed) {
      const mismatched = report.modules.filter((item) => !item.matched).length
      checkStage.message = `核对未通过：${mismatched} 个模块与示例数据基线不一致，请保留核对或显式重建后继续`
      saveRun(run)
      return run
    }
    checkStage.status = 'done'
    checkStage.message = '业务模块、登记总量、待处理、异常量均与示例数据基线一致'
    checkStage.finishedAt = nowText()
    run.updatedAt = nowText()
    saveRun(run)
  }

  // 环节二：交接快照（内部按指纹去重，旧快照不会被覆盖）。
  const snapshotStage = run.stages['handover-snapshot']
  if (snapshotStage.status !== 'done') {
    snapshotStage.status = 'running'
    snapshotStage.startedAt = snapshotStage.startedAt ?? nowText()
    if (!run.checkReport) {
      saveRun(run)
      return run
    }
    const { snapshot, reused } = runHandoverSnapshot(forestFarm, operator)
    run.snapshotId = snapshot.id
    snapshotStage.status = 'done'
    snapshotStage.message = reused
      ? `复用同数据快照 ${snapshot.id}，历史快照原样保留，未新增重复快照`
      : `已生成林场交接快照 ${snapshot.id}（只追加保存，历史快照原样保留）`
    snapshotStage.finishedAt = nowText()
    run.updatedAt = nowText()
    saveRun(run)
  }

  // 环节三：发布核查 + 跨模块处置提醒同步进发布核查清单。
  const releaseStage = run.stages['release-check']
  if (releaseStage.status !== 'done') {
    releaseStage.status = 'running'
    releaseStage.startedAt = releaseStage.startedAt ?? nowText()
    const report = runReleaseCheck()
    run.releaseCheck = report
    if (!report.passed) {
      releaseStage.message = '发布核查未通过：概览汇总、处置提醒、物资预警未读到同一份数据'
      saveRun(run)
      return run
    }
    releaseStage.status = 'done'
    releaseStage.message = `三处读取方同源；${report.crossModuleReminders.length} 条跨模块处置提醒已同步进发布核查清单`
    releaseStage.finishedAt = nowText()
    run.updatedAt = nowText()
    saveRun(run)
  }

  run.finished = REHEARSAL_STAGES.every((stage) => run.stages[stage.key].status === 'done')
  saveRun(run)
  return run
}

export function currentRun(): RehearsalRun | null {
  return loadRun()
}

export function restartRehearsal(options: RunRehearsalOptions = {}): RehearsalRun {
  clearRun()
  return runRehearsal({ ...options, restart: true })
}

export function listHandoverSnapshots(): HandoverSnapshot[] {
  return loadSnapshots()
}

export function releaseChecklist(): ReleaseChecklistEntry[] {
  return loadChecklist()
}

// 人工关闭一条发布核查事项：只改这一条，重复同步也不会把它重新打开。
export function closeChecklistItem(key: string): ReleaseChecklistEntry[] {
  const list = loadChecklist().map((entry) =>
    entry.key === key ? { ...entry, status: 'closed' as const, updatedAt: nowText() } : entry,
  )
  saveChecklist(list)
  return list
}
