/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 上线前演练：环节、检查项、交接快照与发布核查清单的类型。 */

export type DrillStepKey = 'ledger' | 'verify' | 'snapshot'

export type CheckItemKey = 'overview' | 'reminders' | 'supply' | 'release'

export type StepRecord = {
  done: boolean
  doneAt: string | null
  detail: string
}

export type HandoverSnapshot = {
  id: string
  createdAt: string
  digest: string
  overview: OverviewResult
}

export type ReleaseItem = {
  key: string
  title: string
  source: string
  addedAt: string
}

export type PrelaunchState = {
  ledgerDecision: 'keep' | 'rebuild' | null
  steps: Record<DrillStepKey, StepRecord>
  checks: Record<CheckItemKey, StepRecord>
  snapshots: HandoverSnapshot[]
  releaseItems: ReleaseItem[]
}

export type DisposalReminder = {
  key: string
  moduleName: string
  rowId: number
  status: string
  title: string
}

export type SupplyWarning = {
  key: string
  rowId: number
  status: string
  title: string
}

export type StepRunReport = {
  key: string
  name: string
  ok: boolean
  detail: string
}
