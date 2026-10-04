<template>
  <section class="page" data-module="rehearsal">
    <header class="page-head">
      <div>
        <h2>运营概览 · 上线前演练</h2>
        <p class="page-desc">
          用示例数据核对业务模块、登记总量、待处理与异常量，再生成林场交接快照，最后做发布核查；中断后从缺失环节继续。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="busy" @click="continueRun">
          {{ run?.finished ? '演练已完成（再次执行不产生重复事项）' : interrupted ? '从缺失环节继续' : '执行上线演练' }}
        </button>
        <button class="btn" type="button" :disabled="busy" @click="restart">重新发起一轮</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">台账非空时的策略</span>
        <strong class="stat-value">{{ policy === 'keep' ? '保留现有台账' : '重建为示例数据' }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">当前轮次</span>
        <strong class="stat-value">{{ run ? run.id : '尚未开始' }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">历史交接快照</span>
        <strong class="stat-value">{{ snapshots.length }} 份</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">发布核查事项</span>
        <strong class="stat-value">{{ openChecklistCount }} 待办</strong>
      </article>
    </div>

    <label class="filter-item" style="margin-bottom: 10px">
      <span>台账策略（台账不为空时：保留还是重建）</span>
      <select v-model="policy">
        <option value="keep">保留现有台账，仅按示例数据基线核对（默认，不动业务数据）</option>
        <option value="rebuild">重建：所有模块回到示例数据后再核对（核对失败后的修正手段）</option>
      </select>
    </label>

    <h3 style="font-size: 14px">演练环节（中断后自动从缺失环节继续）</h3>
    <table class="data-table">
      <thead>
        <tr><th style="width: 40px">序</th><th>环节</th><th style="width: 90px">状态</th><th>说明</th><th style="width: 150px">完成时间</th></tr>
      </thead>
      <tbody>
        <tr v-for="(stage, index) in stageRows" :key="stage.key">
          <td>{{ index + 1 }}</td>
          <td>{{ stage.label }}</td>
          <td>
            <span :class="['legend-item', stageClass(stage.status)]">{{ stageText(stage.status) }}</span>
          </td>
          <td>{{ stage.message || '—' }}</td>
          <td>{{ stage.finishedAt ?? '—' }}</td>
        </tr>
      </tbody>
    </table>

    <template v-if="report">
      <h3 style="font-size: 14px; margin-top: 16px">① 示例数据核对</h3>
      <p class="status-legend">
        <span class="legend-item" :class="report.passed ? 'ok' : 'bad'">
          {{ report.passed ? '核对通过' : '核对未通过' }}
        </span>
        <span class="legend-item">台账非空：{{ report.ledgerNonEmpty ? '是' : '否' }}</span>
        <span class="legend-item">处置策略：{{ report.ledgerPolicy === 'keep' ? '保留' : '重建' }}</span>
      </p>
      <div class="stat-row">
        <article v-for="metric in report.metrics" :key="metric.label" class="stat-card">
          <span class="stat-label">{{ metric.label }}</span>
          <strong class="stat-value">{{ metric.actual }}</strong>
          <span :class="metric.matched ? 'ok-text' : 'error-text'">
            示例基线 {{ metric.expected }} · {{ metric.matched ? '一致' : '不一致' }}
          </span>
        </article>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>业务模块</th>
            <th>登记量（实际/基线）</th>
            <th>待处理（实际/基线）</th>
            <th>异常量（实际/基线）</th>
            <th>结果</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in report.modules" :key="item.key">
            <td>{{ item.name }}</td>
            <td :class="item.actualCreated === item.expectedCreated ? '' : 'error-text'">
              {{ item.actualCreated }} / {{ item.expectedCreated }}
            </td>
            <td :class="item.actualPending === item.expectedPending ? '' : 'error-text'">
              {{ item.actualPending }} / {{ item.expectedPending }}
            </td>
            <td :class="item.actualAbnormal === item.expectedAbnormal ? '' : 'error-text'">
              {{ item.actualAbnormal }} / {{ item.expectedAbnormal }}
            </td>
            <td :class="item.matched ? 'ok-text' : 'error-text'">{{ item.matched ? '一致' : '不一致' }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-if="currentSnapshot">
      <h3 style="font-size: 14px; margin-top: 16px">② 林场交接快照</h3>
      <p class="status-legend">
        <span class="legend-item ok">{{ currentSnapshot.id }}</span>
        <span class="legend-item">林场：{{ currentSnapshot.forestFarm }}</span>
        <span class="legend-item">生成时间：{{ currentSnapshot.createdAt }}</span>
        <span class="legend-item">数据指纹：{{ currentSnapshot.fingerprint }}</span>
      </p>
      <div class="stat-row">
        <article v-for="card in currentSnapshot.cards" :key="card.label" class="stat-card">
          <span class="stat-label">{{ card.label }}</span>
          <strong class="stat-value">{{ card.value }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">物资预警</span>
          <strong class="stat-value">{{ currentSnapshot.supplyWarnings }}</strong>
        </article>
      </div>
    </template>

    <template v-if="release">
      <h3 style="font-size: 14px; margin-top: 16px">③ 发布核查：三处读取同一份数据</h3>
      <p class="status-legend">
        <span class="legend-item" :class="release.sameSource ? 'ok' : 'bad'">
          {{ release.sameSource ? '同源核对通过' : '数据不一致，禁止上线' }}
        </span>
      </p>
      <table class="data-table">
        <thead>
          <tr><th>读取方</th><th>数据指纹</th><th>登记总量</th><th>待处理</th><th>异常量</th></tr>
        </thead>
        <tbody>
          <tr v-for="probe in release.readers" :key="probe.name">
            <td>{{ probe.name }}</td>
            <td>{{ probe.fingerprint }}</td>
            <td>{{ probe.totalCreated }}</td>
            <td>{{ probe.totalPending }}</td>
            <td>{{ probe.totalAbnormal }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <h3 style="font-size: 14px; margin-top: 16px">发布核查清单（含跨模块处置提醒）</h3>
    <table class="data-table">
      <thead>
        <tr><th>事项</th><th>来源</th><th>类型</th><th>说明</th><th style="width: 80px">状态</th><th style="width: 90px">操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="entry in checklist" :key="entry.key">
          <td>{{ entry.title }}</td>
          <td>{{ entry.scope }}</td>
          <td>{{ kindText(entry.kind) }}</td>
          <td>{{ entry.detail }}</td>
          <td :class="entry.status === 'open' ? 'error-text' : 'ok-text'">
            {{ entry.status === 'open' ? '待办' : '已关闭' }}
          </td>
          <td>
            <button v-if="entry.status === 'open'" class="link" type="button" @click="closeEntry(entry.key)">
              标记关闭
            </button>
            <span v-else class="stat-label">留痕</span>
          </td>
        </tr>
        <tr v-if="!checklist.length">
          <td colspan="6" class="empty-state">还没有发布核查事项，先执行一次上线演练</td>
        </tr>
      </tbody>
    </table>

    <h3 style="font-size: 14px; margin-top: 16px">历史林场交接快照（只追加，永不覆盖）</h3>
    <table class="data-table">
      <thead>
        <tr><th>快照编号</th><th>林场</th><th>生成时间</th><th>登记总量</th><th>待处理</th><th>异常量</th><th>物资预警</th><th>数据指纹</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in snapshots" :key="item.id">
          <td>{{ item.id }}</td>
          <td>{{ item.forestFarm }}</td>
          <td>{{ item.createdAt }}</td>
          <td>{{ item.totalCreated }}</td>
          <td>{{ item.totalPending }}</td>
          <td>{{ item.totalAbnormal }}</td>
          <td>{{ item.supplyWarnings }}</td>
          <td>{{ item.fingerprint }}</td>
        </tr>
        <tr v-if="!snapshots.length">
          <td colspan="8" class="empty-state">暂无交接快照</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>演练状态、快照与发布清单独立保存在本机浏览器，刷新或中断后可从缺失环节继续</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  closeChecklistItem,
  currentRun,
  listHandoverSnapshots,
  releaseChecklist,
  restartRehearsal,
  runRehearsal,
} from '@/api/rehearsal-service'
import type { HandoverSnapshot, LedgerPolicy, RehearsalRun, StageStatus } from '@/data/rehearsal-types'
import { REHEARSAL_STAGES } from '@/data/rehearsal-types'
import type { ReleaseChecklistEntry } from '@/data/rehearsal-store'

const run = ref<RehearsalRun | null>(null)
const snapshots = ref<HandoverSnapshot[]>([])
const checklist = ref<ReleaseChecklistEntry[]>([])
const policy = ref<LedgerPolicy>('keep')
const busy = ref(false)
const message = ref('')
const messageOk = ref(true)

const report = computed(() => run.value?.checkReport ?? null)
const release = computed(() => run.value?.releaseCheck ?? null)
const currentSnapshot = computed(
  () => snapshots.value.find((item) => item.id === run.value?.snapshotId) ?? null,
)
const interrupted = computed(() => !!run.value && !run.value.finished)
const openChecklistCount = computed(() => checklist.value.filter((item) => item.status === 'open').length)

const stageRows = computed(() =>
  REHEARSAL_STAGES.map((stage) => ({
    ...stage,
    ...(run.value?.stages[stage.key] ?? {
      status: 'pending' as StageStatus,
      startedAt: null,
      finishedAt: null,
      message: '',
    }),
  })),
)

function stageText(status: StageStatus): string {
  return { pending: '未开始', running: '进行中', done: '已完成', skipped: '已跳过' }[status]
}

function stageClass(status: StageStatus): string {
  return { pending: '', running: 'warn', done: 'ok', skipped: '' }[status]
}

function kindText(kind: string): string {
  return (
    {
      pending: '待处理提醒',
      abnormal: '异常提醒',
      'supply-warning': '物资预警',
      release: '发布核查',
    } as Record<string, string>
  )[kind] ?? kind
}

function refresh() {
  run.value = currentRun()
  snapshots.value = listHandoverSnapshots()
  checklist.value = releaseChecklist()
  if (run.value) {
    policy.value = run.value.ledgerPolicy
  }
}

function continueRun() {
  busy.value = true
  message.value = ''
  try {
    // 幂等入口：已完成直接返回原结果；中断则从第一个未完成环节继续。
    const result = runRehearsal({ policy: policy.value })
    message.value = result.finished
      ? '演练全部环节已完成；重复执行未产生重复事项'
      : '流程停在未通过或未完成的环节，可修正后从缺失环节继续'
    messageOk.value = result.finished
  } catch (error) {
    message.value = error instanceof Error ? error.message : '演练执行失败'
    messageOk.value = false
  } finally {
    busy.value = false
    refresh()
  }
}

function restart() {
  busy.value = true
  message.value = ''
  try {
    // 新一轮只重置演练编排状态；历史快照与核查清单全部保留。
    const result = restartRehearsal({ policy: policy.value })
    message.value = result.finished
      ? '新一轮演练已完成；同数据快照被复用，未产生重复快照'
      : '新一轮演练停在未完成环节'
    messageOk.value = result.finished
  } catch (error) {
    message.value = error instanceof Error ? error.message : '重新发起失败'
    messageOk.value = false
  } finally {
    busy.value = false
    refresh()
  }
}

function closeEntry(key: string) {
  checklist.value = closeChecklistItem(key)
}

onMounted(refresh)
</script>

<style scoped>
.page-actions {
  display: flex;
  gap: 8px;
}
.ok {
  background: #e7f6ec;
  color: #177245;
}
.warn {
  background: #fdf3e0;
  color: #b25e09;
}
.bad {
  background: #fdecec;
  color: #b42318;
}
.ok-text {
  color: #177245;
  font-size: 12px;
}
</style>
