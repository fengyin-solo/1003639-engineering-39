/** 上线前演练流程用到的类型：环节状态、核对结果、交接快照、发布核查。 */

// 演练环节按顺序推进，中断后靠这个判断从哪里继续。
export type RehearsalStageKey =
  | 'sample-check' // 用示例数据核对业务模块 / 登记总量 / 待处理 / 异常量
  | 'handover-snapshot' // 生成林场交接快照（只追加，不覆盖旧快照）
  | 'release-check' // 发布核查：概览汇总、处置提醒、物资预警读到同一份数据

export const REHEARSAL_STAGES: { key: RehearsalStageKey; label: string }[] = [
  { key: 'sample-check', label: '示例数据核对' },
  { key: 'handover-snapshot', label: '林场交接快照' },
  { key: 'release-check', label: '发布核查' },
]

export type StageStatus = 'pending' | 'running' | 'done' | 'skipped'

// 台账非空时的处置策略：默认保留真实台账，显式选择才重建回示例数据。
export type LedgerPolicy = 'keep' | 'rebuild'

export type MetricCheck = {
  label: string
  expected: number // 示例数据算出的基线值
  actual: number // 当前台账读出的值
  matched: boolean
}

export type ModuleCheck = {
  key: string
  name: string
  expectedCreated: number
  actualCreated: number
  expectedPending: number
  actualPending: number
  expectedAbnormal: number
  actualAbnormal: number
  matched: boolean
}

export type CheckReport = {
  ledgerPolicy: LedgerPolicy
  ledgerNonEmpty: boolean
  metrics: MetricCheck[]
  modules: ModuleCheck[]
  passed: boolean
  finishedAt: string
}

// 林场交接快照：内容指纹相同就复用，绝不重复写入，更不会改动历史快照。
export type HandoverSnapshot = {
  id: string
  fingerprint: string
  forestFarm: string
  operator: string
  createdAt: string
  cards: { label: string; value: number }[]
  moduleCount: number
  totalCreated: number
  totalPending: number
  totalAbnormal: number
  supplyWarnings: number
}

export type ReminderItem = {
  key: string // 稳定去重键：跨模块提醒用 module:id，发布事项用固定键
  scope: string // 所属模块或「发布核查」
  title: string
  detail: string
  kind: 'pending' | 'abnormal' | 'supply-warning' | 'release'
}

export type ReaderProbe = {
  name: string
  fingerprint: string
  totalCreated: number
  totalPending: number
  totalAbnormal: number
}

export type ReleaseCheckReport = {
  // 三个读取方：概览汇总 / 处置提醒 / 物资预警，必须读到同一份数据。
  readers: ReaderProbe[]
  sameSource: boolean
  crossModuleReminders: ReminderItem[]
  releaseItems: ReminderItem[]
  passed: boolean
  finishedAt: string
}

export type StageState = {
  status: StageStatus
  startedAt: string | null
  finishedAt: string | null
  message: string
}

export type RehearsalRun = {
  id: string // 一次演练的稳定标识，重复执行沿用同一轮，不产生重复事项
  ledgerPolicy: LedgerPolicy
  startedAt: string
  updatedAt: string
  stages: Record<RehearsalStageKey, StageState>
  checkReport: CheckReport | null
  snapshotId: string | null
  releaseCheck: ReleaseCheckReport | null
  finished: boolean
}
