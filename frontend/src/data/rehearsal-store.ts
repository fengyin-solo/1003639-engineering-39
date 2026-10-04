import type { HandoverSnapshot, RehearsalRun } from './rehearsal-types'

// 演练数据与业务台账分开存：演练怎么中断重跑都不碰业务数据本身。
const RUN_KEY = 'forest-fire-patrol:rehearsal:run'
const SNAPSHOTS_KEY = 'forest-fire-patrol:rehearsal:snapshots'
const CHECKLIST_KEY = 'forest-fire-patrol:release-checklist'

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(key, JSON.stringify(value))
}

export function loadRun(): RehearsalRun | null {
  return readJSON<RehearsalRun | null>(RUN_KEY, null)
}

export function saveRun(run: RehearsalRun): void {
  writeJSON(RUN_KEY, run)
}

export function clearRun(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(RUN_KEY)
  }
}

export function loadSnapshots(): HandoverSnapshot[] {
  return readJSON<HandoverSnapshot[]>(SNAPSHOTS_KEY, [])
}

// 快照只追加：新快照放到末尾，历史快照原样保留，调用方负责按指纹去重。
export function appendSnapshot(snapshot: HandoverSnapshot): HandoverSnapshot[] {
  const list = loadSnapshots()
  list.push(snapshot)
  writeJSON(SNAPSHOTS_KEY, list)
  return list
}

export type ReleaseChecklistEntry = {
  key: string
  scope: string
  title: string
  detail: string
  kind: string
  status: 'open' | 'closed'
  updatedAt: string
}

export function loadChecklist(): ReleaseChecklistEntry[] {
  return readJSON<ReleaseChecklistEntry[]>(CHECKLIST_KEY, [])
}

export function saveChecklist(list: ReleaseChecklistEntry[]): void {
  writeJSON(CHECKLIST_KEY, list)
}

export function rehearsalStorageKeys(): string[] {
  return [RUN_KEY, SNAPSHOTS_KEY, CHECKLIST_KEY]
}
