import type { PrelaunchState, StepRecord } from './types'

// 上线前演练的进度、交接快照与发布核查清单：和业务台账分开存，
// 重播种示例数据、重置业务模块都碰不到这里，历史快照不会被覆盖。
const STORAGE_KEY = 'forest-fire-patrol:prelaunch'

function emptyStep(): StepRecord {
  return { done: false, doneAt: null, detail: '' }
}

function defaultState(): PrelaunchState {
  return {
    ledgerDecision: null,
    steps: { ledger: emptyStep(), verify: emptyStep(), snapshot: emptyStep() },
    checks: { overview: emptyStep(), reminders: emptyStep(), supply: emptyStep(), release: emptyStep() },
    snapshots: [],
    releaseItems: [],
  }
}

function normalize(parsed: Partial<PrelaunchState> | null): PrelaunchState {
  const base = defaultState()
  if (!parsed || typeof parsed !== 'object') {
    return base
  }
  return {
    ledgerDecision: parsed.ledgerDecision ?? null,
    steps: { ...base.steps, ...(parsed.steps ?? {}) },
    checks: { ...base.checks, ...(parsed.checks ?? {}) },
    snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
    releaseItems: Array.isArray(parsed.releaseItems) ? parsed.releaseItems : [],
  }
}

let cache: PrelaunchState | null = null

export function loadPrelaunchState(): PrelaunchState {
  if (cache !== null) {
    return cache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = defaultState()
    return cache
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    cache = defaultState()
    return cache
  }
  try {
    cache = normalize(JSON.parse(raw) as Partial<PrelaunchState>)
  } catch {
    cache = defaultState()
  }
  return cache
}

export function savePrelaunchState(state: PrelaunchState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

// 只重置演练与检查的进度：历史交接快照保持原样，发布核查清单保留（靠 key 去重，重跑不会重复）。
export function resetPrelaunchProgress(): PrelaunchState {
  const current = loadPrelaunchState()
  const next: PrelaunchState = {
    ...defaultState(),
    snapshots: current.snapshots,
    releaseItems: current.releaseItems,
  }
  savePrelaunchState(next)
  return next
}
