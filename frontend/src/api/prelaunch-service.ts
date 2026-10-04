import { MODULES } from '@/data/modules'
import { allRows, listRows, resetRows } from '@/data/local-store'
import { loadPrelaunchState, savePrelaunchState } from '@/data/prelaunch-store'
import type {
  CheckItemKey,
  DisposalReminder,
  DrillStepKey,
  HandoverSnapshot,
  PrelaunchState,
  StepRecord,
  StepRunReport,
  SupplyWarning,
} from '@/data/types'
import { loadOverview } from './local-service'

// 演练环节与检查项的登记：数组顺序即执行顺序，中断后从第一个未完成的继续。
export const DRILL_STEPS: { key: DrillStepKey; name: string; desc: string }[] = [
  { key: 'ledger', name: '台账核对', desc: '台账为空则用示例数据重建；不为空则保留现有台账，不清空重播' },
  { key: 'verify', name: '概览数据核对', desc: '用台账逐行复核业务模块、登记总量、待处理与异常量' },
  { key: 'snapshot', name: '生成交接快照', desc: '把当前概览固化成林场交接快照；数据未变化时不重复生成' },
]

export const CHECK_ITEMS: { key: CheckItemKey; name: string; desc: string }[] = [
  { key: 'overview', name: '概览汇总一致性', desc: '概览四张汇总卡与台账读到同一份数据' },
  { key: 'reminders', name: '处置提醒一致性', desc: '跨模块处置提醒与概览「待处理」读到同一份数据' },
  { key: 'supply', name: '物资预警一致性', desc: '物资预警与物资储备台账读到同一份数据' },
  { key: 'release', name: '发布核查登记', desc: '跨模块处置提醒同步加入发布核查清单，重复执行不重复登记' },
]

// 物资预警口径：物资储备里状态不是「充足」的记录。
const SUPPLY_WARNING_STATUSES = ['偏低', '需补充', '已过期']

function now(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function digestOf(value: unknown): string {
  const text = JSON.stringify(value)
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

// 台账数据指纹：概览、处置提醒、物资预警是否读到同一份数据，就看指纹是否一致。
export function dataFingerprint(): string {
  return digestOf(allRows())
}

export function listDisposalReminders(): DisposalReminder[] {
  const rows = allRows()
  const reminders: DisposalReminder[] = []
  for (const meta of MODULES) {
    for (const row of rows[meta.key] ?? []) {
      if (row.pending) {
        reminders.push({
          key: `reminder:${meta.key}:${row.id}`,
          moduleName: meta.name,
          rowId: Number(row.id),
          status: String(row.status),
          title: `${meta.name}#${row.id} 待处置（当前状态：${row.status}）`,
        })
      }
    }
  }
  return reminders
}

export function listSupplyWarnings(): SupplyWarning[] {
  return listRows('supply')
    .filter((row) => SUPPLY_WARNING_STATUSES.includes(String(row.status)))
    .map((row) => ({
      key: `supply:${row.id}`,
      rowId: Number(row.id),
      status: String(row.status),
      title: `物资储备#${row.id} 库存预警（当前状态：${row.status}）`,
    }))
}

function ledgerTotals() {
  const rows = allRows()
  let created = 0
  let pending = 0
  let abnormal = 0
  for (const meta of MODULES) {
    const list = rows[meta.key] ?? []
    created += list.length
    pending += list.filter((row) => row.pending).length
    abnormal += list.filter((row) => row.abnormal).length
  }
  return { created, pending, abnormal }
}

// ---- 演练环节 ----

function runLedgerStep(state: PrelaunchState): string {
  const totals = ledgerTotals()
  if (totals.created === 0) {
    for (const meta of MODULES) {
      resetRows(meta.key)
    }
    const seeded = ledgerTotals()
    state.ledgerDecision = 'rebuild'
    return `台账为空，已用示例数据重建 ${MODULES.length} 个业务模块，共 ${seeded.created} 条记录`
  }
  state.ledgerDecision = 'keep'
  return `台账已有 ${totals.created} 条记录，选择保留现有台账，不用示例数据重建`
}

function runVerifyStep(): string {
  const overview = loadOverview()
  const rows = allRows()
  const mismatches: string[] = []
  for (const meta of MODULES) {
    const list = rows[meta.key] ?? []
    const line = overview.modules.find((item) => item.name === meta.name)
    if (
      !line ||
      line.created !== list.length ||
      line.pending !== list.filter((row) => row.pending).length ||
      line.abnormal !== list.filter((row) => row.abnormal).length
    ) {
      mismatches.push(meta.name)
    }
  }
  const totals = ledgerTotals()
  const cards = new Map(overview.cards.map((card) => [card.label, card.value]))
  if (cards.get('业务模块') !== MODULES.length) mismatches.push('业务模块')
  if (cards.get('登记总量') !== totals.created) mismatches.push('登记总量')
  if (cards.get('待处理') !== totals.pending) mismatches.push('待处理')
  if (cards.get('异常量') !== totals.abnormal) mismatches.push('异常量')
  if (mismatches.length > 0) {
    throw new Error(`概览汇总与台账对不上：${mismatches.join('、')}`)
  }
  return `核对通过：业务模块 ${MODULES.length} 个、登记总量 ${totals.created} 条、待处理 ${totals.pending} 条、异常量 ${totals.abnormal} 条`
}

function runSnapshotStep(state: PrelaunchState): string {
  const overview = loadOverview()
  const digest = digestOf(overview)
  const latest = state.snapshots[state.snapshots.length - 1]
  if (latest && latest.digest === digest) {
    return `概览数据与最近快照 ${latest.id} 一致，沿用原快照，不重复生成`
  }
  const seq =
    state.snapshots.reduce((max, item) => {
      const num = Number(item.id.replace(/^SNAP-/, ''))
      return Number.isFinite(num) ? Math.max(max, num) : max
    }, 0) + 1
  const snapshot: HandoverSnapshot = {
    id: `SNAP-${String(seq).padStart(4, '0')}`,
    createdAt: now(),
    digest,
    overview,
  }
  // 只追加，不改历史快照。
  state.snapshots.push(snapshot)
  const totals = ledgerTotals()
  return `已生成林场交接快照 ${snapshot.id}：登记总量 ${totals.created} 条、待处理 ${totals.pending} 条、异常量 ${totals.abnormal} 条`
}

// ---- 上线前检查 ----

function runOverviewCheck(): string {
  const fingerprint = dataFingerprint()
  const overview = loadOverview()
  const totals = ledgerTotals()
  if (dataFingerprint() !== fingerprint) {
    throw new Error('读取期间台账被改动，请重新检查')
  }
  const cards = new Map(overview.cards.map((card) => [card.label, card.value]))
  if (
    cards.get('业务模块') !== MODULES.length ||
    cards.get('登记总量') !== totals.created ||
    cards.get('待处理') !== totals.pending ||
    cards.get('异常量') !== totals.abnormal
  ) {
    throw new Error('概览汇总与台账读数不一致')
  }
  return `概览汇总与台账同源（数据指纹 ${fingerprint}）：总量 ${totals.created}、待处理 ${totals.pending}、异常 ${totals.abnormal}`
}

function runRemindersCheck(): string {
  const fingerprint = dataFingerprint()
  const reminders = listDisposalReminders()
  const overview = loadOverview()
  if (dataFingerprint() !== fingerprint) {
    throw new Error('读取期间台账被改动，请重新检查')
  }
  const pendingCard = overview.cards.find((card) => card.label === '待处理')?.value
  if (pendingCard !== reminders.length) {
    throw new Error(`处置提醒 ${reminders.length} 条，与概览待处理 ${pendingCard} 条不一致`)
  }
  return `处置提醒 ${reminders.length} 条，与概览「待处理」同源（数据指纹 ${fingerprint}）`
}

function runSupplyCheck(): string {
  const fingerprint = dataFingerprint()
  const warnings = listSupplyWarnings()
  const expected = listRows('supply').filter((row) =>
    SUPPLY_WARNING_STATUSES.includes(String(row.status)),
  ).length
  if (dataFingerprint() !== fingerprint) {
    throw new Error('读取期间台账被改动，请重新检查')
  }
  if (warnings.length !== expected) {
    throw new Error(`物资预警 ${warnings.length} 条，与物资储备台账 ${expected} 条不一致`)
  }
  return `物资预警 ${warnings.length} 条，与物资储备台账同源（数据指纹 ${fingerprint}）`
}

function runReleaseCheck(state: PrelaunchState): string {
  const reminders = listDisposalReminders()
  const known = new Set(state.releaseItems.map((item) => item.key))
  let added = 0
  for (const reminder of reminders) {
    if (known.has(reminder.key)) {
      continue
    }
    state.releaseItems.push({
      key: reminder.key,
      title: reminder.title,
      source: '跨模块处置提醒',
      addedAt: now(),
    })
    known.add(reminder.key)
    added += 1
  }
  return added > 0
    ? `已把 ${added} 条跨模块处置提醒登记进发布核查清单`
    : '跨模块处置提醒已在发布核查清单中，未重复登记'
}

// ---- 可断点续跑的执行器：每个环节落盘一次，中断后从缺失环节继续，已完成的跳过 ----

type StepFn = (state: PrelaunchState) => string

const DRILL_IMPL: Record<DrillStepKey, StepFn> = {
  ledger: runLedgerStep,
  verify: runVerifyStep,
  snapshot: runSnapshotStep,
}

const CHECK_IMPL: Record<CheckItemKey, StepFn> = {
  overview: runOverviewCheck,
  reminders: runRemindersCheck,
  supply: runSupplyCheck,
  release: runReleaseCheck,
}

function runSequence<K extends string>(
  items: { key: K; name: string }[],
  records: Record<K, StepRecord>,
  impl: Record<K, StepFn>,
  state: PrelaunchState,
): StepRunReport[] {
  const reports: StepRunReport[] = []
  for (const item of items) {
    if (records[item.key].done) {
      continue
    }
    try {
      const detail = impl[item.key](state)
      records[item.key] = { done: true, doneAt: now(), detail }
      reports.push({ key: item.key, name: item.name, ok: true, detail })
    } catch (error) {
      const detail = error instanceof Error ? error.message : '执行失败'
      records[item.key] = { done: false, doneAt: null, detail }
      reports.push({ key: item.key, name: item.name, ok: false, detail })
      savePrelaunchState(state)
      return reports
    }
    savePrelaunchState(state)
  }
  return reports
}

export function runDrill(): { reports: StepRunReport[]; state: PrelaunchState } {
  const state = loadPrelaunchState()
  const reports = runSequence(DRILL_STEPS, state.steps, DRILL_IMPL, state)
  savePrelaunchState(state)
  return { reports, state }
}

export function runPrelaunchCheck(): { reports: StepRunReport[]; state: PrelaunchState } {
  const state = loadPrelaunchState()
  const reports = runSequence(CHECK_ITEMS, state.checks, CHECK_IMPL, state)
  savePrelaunchState(state)
  return { reports, state }
}
