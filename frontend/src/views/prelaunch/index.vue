<template>
  <section class="page" data-module="prelaunch">
    <header class="page-head">
      <div>
        <h2>上线前演练</h2>
        <p class="page-desc">用示例数据走一遍上线前流程：核对台账与概览、生成林场交接快照、完成上线前检查。中断后再点一次就从缺失环节继续。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="runDrillFlow">继续演练</button>
        <button class="btn" type="button" @click="runCheckFlow">继续检查</button>
        <button class="btn ghost" type="button" @click="restart">重置演练进度</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">台账决策</span>
        <strong class="stat-value">{{ ledgerDecisionLabel }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">处置提醒</span>
        <strong class="stat-value">{{ reminders.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">物资预警</span>
        <strong class="stat-value">{{ warnings.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">交接快照</span>
        <strong class="stat-value">{{ state.snapshots.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">发布核查事项</span>
        <strong class="stat-value">{{ state.releaseItems.length }}</strong>
      </article>
    </div>

    <h3 class="section-title">演练流程</h3>
    <table class="data-table">
      <thead>
        <tr><th>环节</th><th>说明</th><th>状态</th><th>结果</th></tr>
      </thead>
      <tbody>
        <tr v-for="step in DRILL_STEPS" :key="step.key">
          <td>{{ step.name }}</td>
          <td>{{ step.desc }}</td>
          <td>{{ stepStatus(state.steps[step.key]) }}</td>
          <td>{{ state.steps[step.key].detail || '—' }}</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">上线前检查</h3>
    <table class="data-table">
      <thead>
        <tr><th>检查项</th><th>说明</th><th>状态</th><th>结果</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in CHECK_ITEMS" :key="item.key">
          <td>{{ item.name }}</td>
          <td>{{ item.desc }}</td>
          <td>{{ stepStatus(state.checks[item.key]) }}</td>
          <td>{{ state.checks[item.key].detail || '—' }}</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">林场交接快照</h3>
    <table class="data-table">
      <thead>
        <tr><th>快照编号</th><th>生成时间</th><th>登记总量</th><th>待处理</th><th>异常量</th><th>数据指纹</th></tr>
      </thead>
      <tbody>
        <tr v-for="snapshot in state.snapshots" :key="snapshot.id">
          <td>{{ snapshot.id }}</td>
          <td>{{ snapshot.createdAt }}</td>
          <td>{{ cardValue(snapshot, '登记总量') }}</td>
          <td>{{ cardValue(snapshot, '待处理') }}</td>
          <td>{{ cardValue(snapshot, '异常量') }}</td>
          <td>{{ snapshot.digest }}</td>
        </tr>
        <tr v-if="!state.snapshots.length">
          <td colspan="6" class="empty-state">暂无交接快照，完成演练后生成；历史快照只增不改</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">发布核查清单</h3>
    <table class="data-table">
      <thead>
        <tr><th>核查事项</th><th>来源</th><th>登记时间</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in state.releaseItems" :key="item.key">
          <td>{{ item.title }}</td>
          <td>{{ item.source }}</td>
          <td>{{ item.addedAt }}</td>
        </tr>
        <tr v-if="!state.releaseItems.length">
          <td colspan="3" class="empty-state">暂无核查事项，完成上线前检查后登记</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>演练进度与快照保存在本机浏览器，重播种示例数据不会覆盖历史快照</span>
      <span v-if="message" :class="messageOk ? '' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  CHECK_ITEMS,
  DRILL_STEPS,
  listDisposalReminders,
  listSupplyWarnings,
  runDrill,
  runPrelaunchCheck,
} from '@/api/prelaunch-service'
import { loadPrelaunchState, resetPrelaunchProgress } from '@/data/prelaunch-store'
import type {
  DisposalReminder,
  HandoverSnapshot,
  PrelaunchState,
  StepRecord,
  StepRunReport,
  SupplyWarning,
} from '@/data/types'

const state = ref<PrelaunchState>({ ...loadPrelaunchState() })
const reminders = ref<DisposalReminder[]>([])
const warnings = ref<SupplyWarning[]>([])
const message = ref('')
const messageOk = ref(true)

const ledgerDecisionLabel = computed(() => {
  if (state.value.ledgerDecision === 'keep') return '保留台账'
  if (state.value.ledgerDecision === 'rebuild') return '重建台账'
  return '未执行'
})

function stepStatus(record: StepRecord): string {
  return record.done ? `已完成 ${record.doneAt ?? ''}` : '待执行'
}

function cardValue(snapshot: HandoverSnapshot, label: string): number | string {
  return snapshot.overview.cards.find((card) => card.label === label)?.value ?? '—'
}

function refresh() {
  state.value = { ...loadPrelaunchState() }
  reminders.value = listDisposalReminders()
  warnings.value = listSupplyWarnings()
}

function summarize(label: string, reports: StepRunReport[]) {
  const failed = reports.find((report) => !report.ok)
  if (failed) {
    messageOk.value = false
    message.value = `${label}在「${failed.name}」中断：${failed.detail}，处理后再点一次即可继续`
    return
  }
  messageOk.value = true
  message.value = reports.length > 0
    ? `${label}完成 ${reports.length} 个环节：${reports.map((report) => report.name).join('、')}`
    : `${label}没有待执行的环节，重复执行不会产生重复事项`
}

function runDrillFlow() {
  const { reports } = runDrill()
  summarize('演练', reports)
  refresh()
}

function runCheckFlow() {
  const { reports } = runPrelaunchCheck()
  summarize('检查', reports)
  refresh()
}

function restart() {
  resetPrelaunchProgress()
  messageOk.value = true
  message.value = '演练与检查进度已重置，历史交接快照与发布核查清单保持原样'
  refresh()
}

onMounted(refresh)
</script>

<style scoped>
.section-title {
  font-size: 14px;
  margin: 16px 0 8px;
}
</style>
