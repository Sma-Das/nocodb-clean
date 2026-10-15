<script setup lang="ts">
import type { SourceAnalyticsResponse, SourceType } from 'nocodb-sdk'

const props = defineProps<{ baseId: string }>()
const { $api } = useNuxtApp()
const { t } = useI18n()
const { user } = useGlobal()
const sources = ref<SourceType[]>([])
const sourceId = ref('')
const minutes = ref(15)
const refreshSeconds = ref(0)
const chart = ref<'count' | 'avgMs' | 'errors'>('count')
const operation = ref('all')
const response = shallowRef<SourceAnalyticsResponse | null>(null)
const loading = ref(false)
const error = ref('')
const savedName = ref('')
const savedId = ref('')
const latencyThreshold = ref(1000)
const errorThreshold = ref(5)
const storageMessage = ref('')
type SavedView = {
  name: string
  sourceId: string
  minutes: number
  chart: 'count' | 'avgMs' | 'errors'
  operation: string
  latency: number
  errors: number
}
const savedViews = ref<SavedView[]>([])
const storageKey = computed(() => `nc-source-analytics:${user.value?.id ?? 'anonymous'}:${props.baseId}`)
let generation = 0
let controller: AbortController | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
const metrics = computed(() => response.value?.metrics)
const queries = computed(
  () => metrics.value?.queries.filter((q) => operation.value === 'all' || q.operation === operation.value) ?? [],
)
const chartMax = computed(() => Math.max(1, ...(metrics.value?.series.map((point) => point[chart.value]) ?? [])))
const validLatencyThreshold = computed(() => Number.isFinite(latencyThreshold.value) && latencyThreshold.value >= 1)
const validErrorThreshold = computed(
  () => Number.isFinite(errorThreshold.value) && errorThreshold.value >= 0.1 && errorThreshold.value <= 100,
)
const validThresholds = computed(() => validLatencyThreshold.value && validErrorThreshold.value)
const warnings = computed(() => {
  const summary = metrics.value?.summary
  return [
    validThresholds.value && summary?.count && summary.maxMs >= latencyThreshold.value
      ? t('sourceAnalytics.latencyWarning', { value: ms(summary.maxMs) })
      : '',
    validThresholds.value && summary?.count && summary.errorRate >= errorThreshold.value
      ? t('sourceAnalytics.errorWarning', { value: summary.errorRate.toFixed(1) })
      : '',
    response.value?.pool?.pending ? t('sourceAnalytics.poolWarning', { value: response.value.pool.pending }) : '',
  ].filter(Boolean)
})

function ms(value: number) {
  return `${value.toFixed(1)} ms`
}
function bytes(value?: number) {
  if (value === undefined) return '—'
  return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GiB` : `${(value / 1024 ** 2).toFixed(1)} MiB`
}
function time(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function schedule() {
  clearTimeout(timer)
  if (!disposed && refreshSeconds.value > 0)
    timer = setTimeout(() => {
      if (document.hidden) schedule()
      else load()
    }, refreshSeconds.value * 1000)
}

async function load() {
  const current = ++generation
  controller?.abort()
  clearTimeout(timer)
  if (!sourceId.value) {
    response.value = null
    loading.value = false
    return
  }
  controller = new AbortController()
  loading.value = true
  error.value = ''
  try {
    const { data } = await $api.instance.get<SourceAnalyticsResponse>(
      `/api/v2/meta/bases/${encodeURIComponent(props.baseId)}/sources/${encodeURIComponent(sourceId.value)}/analytics`,
      { params: { minutes: minutes.value }, signal: controller.signal },
    )
    if (current === generation) response.value = data
  } catch (e: any) {
    if (current === generation && e?.code !== 'ERR_CANCELED') error.value = t('sourceAnalytics.loadError')
  } finally {
    if (current === generation) {
      loading.value = false
      schedule()
    }
  }
}

function saveView() {
  if (!validThresholds.value) {
    storageMessage.value = t('sourceAnalytics.invalidThresholds')
    return
  }
  const name = savedName.value.trim().slice(0, 80)
  if (!name) return
  const view = {
    name,
    sourceId: sourceId.value,
    minutes: minutes.value,
    chart: chart.value,
    operation: operation.value,
    latency: latencyThreshold.value,
    errors: errorThreshold.value,
  }
  const next = [...savedViews.value.filter((item) => item.name !== name), view].slice(-20)
  try {
    localStorage.setItem(storageKey.value, JSON.stringify(next))
    savedViews.value = next
    savedId.value = name
    storageMessage.value = t('sourceAnalytics.saved')
  } catch {
    storageMessage.value = t('sourceAnalytics.storageError')
  }
}

function restoreView() {
  const view = savedViews.value.find((item) => item.name === savedId.value)
  if (!view) return
  sourceId.value = sources.value.some((source) => source.id === view.sourceId) ? view.sourceId : sourceId.value
  minutes.value = view.minutes
  chart.value = view.chart
  operation.value = view.operation
  latencyThreshold.value = view.latency
  errorThreshold.value = view.errors
  savedName.value = view.name
}

function deleteView() {
  const next = savedViews.value.filter((item) => item.name !== savedId.value)
  try {
    localStorage.setItem(storageKey.value, JSON.stringify(next))
    savedViews.value = next
    savedId.value = ''
  } catch {
    storageMessage.value = t('sourceAnalytics.storageError')
  }
}

watch([sourceId, minutes], () => {
  response.value = null
  load()
})
watch(refreshSeconds, schedule)
onMounted(async () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey.value) || '[]')
    if (Array.isArray(parsed))
      savedViews.value = parsed
        .filter(
          (v) =>
            typeof v?.name === 'string' &&
            typeof v.sourceId === 'string' &&
            [5, 15, 60].includes(v.minutes) &&
            ['count', 'avgMs', 'errors'].includes(v.chart) &&
            ['all', 'select', 'first', 'insert', 'update', 'del', 'delete', 'raw', 'other'].includes(v.operation) &&
            Number.isFinite(v.latency) &&
            v.latency >= 1 &&
            Number.isFinite(v.errors) &&
            v.errors >= 0.1 &&
            v.errors <= 100,
        )
        .slice(-20)
  } catch {
    storageMessage.value = t('sourceAnalytics.storageError')
  }
  try {
    const data = await $api.source.list(props.baseId)
    if (disposed) return
    sources.value = data.list ?? []
    sourceId.value =
      sources.value.find((source) => !source.is_meta && !source.is_local && source.enabled)?.id ?? sources.value[0]?.id ?? ''
  } catch {
    if (!disposed) error.value = t('sourceAnalytics.loadError')
  }
})
onBeforeUnmount(() => {
  disposed = true
  generation++
  controller?.abort()
  clearTimeout(timer)
})
</script>

<template>
  <div
    class="nc-source-analytics h-full min-h-0 p-4 md:p-6 flex flex-col gap-6 overflow-auto nc-scrollbar-thin"
    :aria-busy="loading"
    data-testid="nc-source-analytics"
  >
    <div class="flex flex-wrap items-end gap-3">
      <label class="flex flex-col gap-1 min-w-40 flex-1"
        >{{ t('sourceAnalytics.source') }}
        <select v-model="sourceId">
          <option v-for="source in sources" :key="source.id" :value="source.id">
            {{ source.alias || t('sourceAnalytics.defaultSource') }}
          </option>
        </select>
      </label>
      <label class="flex flex-col gap-1"
        >{{ t('sourceAnalytics.range') }}
        <select v-model.number="minutes">
          <option v-for="value in [5, 15, 60]" :key="value" :value="value">
            {{ t('sourceAnalytics.lastMinutes', { value }) }}
          </option>
        </select>
      </label>
      <label class="flex flex-col gap-1"
        >{{ t('sourceAnalytics.refresh') }}
        <select v-model.number="refreshSeconds">
          <option :value="0">{{ t('sourceAnalytics.manual') }}</option>
          <option v-for="value in [15, 30, 60]" :key="value" :value="value">{{ t('sourceAnalytics.seconds', { value }) }}</option>
        </select>
      </label>
      <NcButton :disabled="loading || !sourceId" @click="load">{{ t('sourceAnalytics.refreshNow') }}</NcButton>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="!sources.length && !error">{{ t('sourceAnalytics.noSources') }}</p>
    <p v-if="response && !response.supported">{{ t('sourceAnalytics.internalSource') }}</p>
    <p v-else-if="response && !response.enabled">{{ t('sourceAnalytics.disabled') }}</p>
    <p v-else-if="response && !response.sourceEnabled">{{ t('sourceAnalytics.sourceDisabled') }}</p>
    <template v-if="metrics">
      <p class="text-nc-content-gray-subtle text-sm">
        {{ t('sourceAnalytics.scope') }} {{ t('sourceAnalytics.since', { value: new Date(metrics.startedAt).toLocaleString() }) }}
      </p>
      <dl class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <dt>{{ t('sourceAnalytics.queries') }}</dt>
          <dd>{{ metrics.summary.count.toLocaleString() }}</dd>
        </div>
        <div>
          <dt>{{ t('sourceAnalytics.average') }}</dt>
          <dd>{{ ms(metrics.summary.avgMs) }}</dd>
        </div>
        <div>
          <dt>{{ t('sourceAnalytics.p95') }}</dt>
          <dd>
            {{
              metrics.summary.p95Overflow
                ? '> 10,000 ms'
                : metrics.summary.p95UpperMs === null
                  ? '—'
                  : `≤ ${ms(metrics.summary.p95UpperMs)}`
            }}
          </dd>
        </div>
        <div>
          <dt>{{ t('sourceAnalytics.errors') }}</dt>
          <dd>{{ metrics.summary.errorRate.toFixed(1) }}% ({{ metrics.summary.errors }})</dd>
        </div>
      </dl>
      <section class="flex flex-col gap-3">
        <h3>{{ t('sourceAnalytics.activity') }}</h3>
        <label class="flex items-center gap-3"
          >{{ t('sourceAnalytics.metric') }}
          <select v-model="chart">
            <option value="count">{{ t('sourceAnalytics.queries') }}</option>
            <option value="avgMs">{{ t('sourceAnalytics.average') }}</option>
            <option value="errors">{{ t('sourceAnalytics.errors') }}</option>
          </select>
        </label>
        <div
          class="flex h-32 items-end gap-1 border-b border-nc-border-gray-medium"
          role="img"
          :aria-label="t('sourceAnalytics.chartDescription')"
        >
          <div
            v-for="point in metrics.series"
            :key="point.timestamp"
            class="bg-nc-fill-primary flex-1 min-w-0 rounded-t"
            :style="{ height: `${(point[chart] / chartMax) * 100}%` }"
            :title="`${time(point.timestamp)}: ${!point.observed ? t('sourceAnalytics.noData') : chart === 'avgMs' ? ms(point[chart]) : point[chart]}`"
          />
        </div>
        <div class="flex justify-between text-sm">
          <span>{{ time(metrics.from) }}</span
          ><span>{{ time(metrics.to) }}</span>
        </div>
        <details>
          <summary>{{ t('sourceAnalytics.chartData') }}</summary>
          <table>
            <caption class="sr-only">
              {{
                t('sourceAnalytics.activity')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('sourceAnalytics.time') }}</th>
                <th scope="col">{{ t('sourceAnalytics.queries') }}</th>
                <th scope="col">{{ t('sourceAnalytics.average') }}</th>
                <th scope="col">{{ t('sourceAnalytics.errors') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="point in metrics.series" :key="point.timestamp">
                <th scope="row">{{ time(point.timestamp) }}</th>
                <td>{{ point.observed ? point.count : t('sourceAnalytics.noData') }}</td>
                <td>{{ point.observed ? ms(point.avgMs) : t('sourceAnalytics.noData') }}</td>
                <td>{{ point.observed ? point.errors : t('sourceAnalytics.noData') }}</td>
              </tr>
            </tbody>
          </table>
        </details>
        <p v-if="!metrics.summary.count">{{ t('sourceAnalytics.noQueries') }}</p>
      </section>
      <section class="flex flex-col gap-3">
        <h3>{{ t('sourceAnalytics.expensiveQueries') }}</h3>
        <p class="text-sm text-nc-content-gray-subtle">{{ t('sourceAnalytics.queryPrivacy') }}</p>
        <label class="flex items-center gap-3"
          >{{ t('sourceAnalytics.operation')
          }}<select v-model="operation">
            <option value="all">{{ t('sourceAnalytics.all') }}</option>
            <option
              v-for="value in ['select', 'first', 'insert', 'update', 'del', 'delete', 'raw', 'other']"
              :key="value"
              :value="value"
            >
              {{ value }}
            </option>
          </select></label
        >
        <div class="overflow-x-auto">
          <table>
            <caption class="sr-only">
              {{
                t('sourceAnalytics.expensiveQueries')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('sourceAnalytics.queryId') }}</th>
                <th scope="col">{{ t('sourceAnalytics.operation') }}</th>
                <th scope="col">{{ t('sourceAnalytics.queries') }}</th>
                <th scope="col">{{ t('sourceAnalytics.total') }}</th>
                <th scope="col">{{ t('sourceAnalytics.maximum') }}</th>
                <th scope="col">{{ t('sourceAnalytics.errors') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="query in queries" :key="query.queryId">
                <th scope="row" class="font-mono">{{ query.queryId }}</th>
                <td>{{ query.operation }}</td>
                <td>{{ query.count }}</td>
                <td>{{ ms(query.totalMs) }}</td>
                <td>{{ ms(query.maxMs) }}</td>
                <td>{{ query.errors }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>{{ t('sourceAnalytics.slowQueries', { value: metrics.summary.slow }) }}</p>
        <p v-if="metrics.dropped">{{ t('sourceAnalytics.dropped', { value: metrics.dropped }) }}</p>
      </section>
      <section class="flex flex-col gap-3">
        <h3>{{ t('sourceAnalytics.health') }}</h3>
        <dl class="grid grid-cols-2 gap-4">
          <div>
            <dt>{{ t('sourceAnalytics.poolUsed') }}</dt>
            <dd>{{ response?.pool?.used ?? '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('sourceAnalytics.poolWaiting') }}</dt>
            <dd>{{ response?.pool?.pending ?? '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('sourceAnalytics.storage') }}</dt>
            <dd>{{ bytes(response?.health?.storageBytes) }}</dd>
          </div>
          <div>
            <dt>{{ t('sourceAnalytics.connections') }}</dt>
            <dd>{{ response?.health?.connections ?? '—' }}</dd>
          </div>
        </dl>
        <p>{{ t('sourceAnalytics.healthScope') }}</p>
        <p v-if="response?.health?.status === 'unavailable'">{{ t('sourceAnalytics.healthUnavailable') }}</p>
        <p v-else-if="response?.health?.status === 'unsupported'">{{ t('sourceAnalytics.healthUnsupported') }}</p>
        <div v-if="response?.health?.tables.length" class="overflow-x-auto">
          <table>
            <caption>
              {{
                t('sourceAnalytics.tables')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('sourceAnalytics.table') }}</th>
                <th scope="col">{{ t('sourceAnalytics.estimatedRows') }}</th>
                <th scope="col">{{ t('sourceAnalytics.deadRows') }}</th>
                <th scope="col">{{ t('sourceAnalytics.tableStorage') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="table in response.health.tables" :key="table.name">
                <th scope="row">{{ table.name }}</th>
                <td>{{ table.estimatedRows.toLocaleString() }}</td>
                <td>{{ table.deadRows?.toLocaleString() ?? '—' }}</td>
                <td>{{ bytes(table.bytes) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="flex flex-col gap-3">
        <h3>{{ t('sourceAnalytics.warnings') }}</h3>
        <p>{{ t('sourceAnalytics.warningScope') }}</p>
        <div class="flex flex-wrap gap-3">
          <label
            >{{ t('sourceAnalytics.latencyThreshold') }}
            <input
              v-model.number="latencyThreshold"
              type="number"
              min="1"
              step="any"
              :aria-invalid="!validLatencyThreshold"
              :aria-describedby="!validLatencyThreshold ? 'source-analytics-threshold-error' : undefined" /></label
          ><label
            >{{ t('sourceAnalytics.errorThreshold') }}
            <input
              v-model.number="errorThreshold"
              type="number"
              min="0.1"
              max="100"
              step="0.1"
              :aria-invalid="!validErrorThreshold"
              :aria-describedby="!validErrorThreshold ? 'source-analytics-threshold-error' : undefined"
          /></label>
        </div>
        <ul v-if="warnings.length">
          <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
        </ul>
        <p v-if="!validThresholds" id="source-analytics-threshold-error">{{ t('sourceAnalytics.invalidThresholds') }}</p>
        <p v-else-if="!metrics.summary.count">{{ t('sourceAnalytics.noWarningData') }}</p>
        <p v-else-if="!warnings.length">{{ t('sourceAnalytics.noWarnings') }}</p>
      </section>
    </template>
    <section class="flex flex-col gap-3">
      <h3>{{ t('sourceAnalytics.savedViews') }}</h3>
      <p>{{ t('sourceAnalytics.savedScope') }}</p>
      <div class="flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1">{{ t('sourceAnalytics.viewName') }}<input v-model="savedName" maxlength="80" /></label
        ><NcButton :disabled="!savedName.trim() || !sourceId" @click="saveView">{{ t('sourceAnalytics.saveView') }}</NcButton>
        <label class="flex flex-col gap-1"
          >{{ t('sourceAnalytics.savedViews')
          }}<select v-model="savedId" @change="restoreView">
            <option value="">{{ t('sourceAnalytics.chooseView') }}</option>
            <option v-for="view in savedViews" :key="view.name" :value="view.name">{{ view.name }}</option>
          </select></label
        ><NcButton :disabled="!savedId" @click="deleteView">{{ t('sourceAnalytics.deleteView') }}</NcButton>
      </div>
      <p role="status">{{ storageMessage }}</p>
    </section>
  </div>
</template>

<style scoped lang="scss">
.nc-source-analytics {
  select,
  input {
    @apply border-1 border-nc-border-gray-medium rounded-md px-2 py-2 bg-nc-bg-default max-w-full;
  }
  input[type='number'] {
    width: 7rem;
  }
  h3 {
    @apply font-semibold text-base;
  }
  dd {
    @apply text-xl font-semibold mt-1;
    font-variant-numeric: tabular-nums;
  }
  dt {
    @apply text-nc-content-gray-subtle text-sm;
  }
  table {
    @apply w-full text-sm;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    @apply text-start p-2;
  }
  th {
    @apply font-medium;
  }
  tr {
    @apply border-b border-nc-border-gray-medium;
  }
  summary {
    @apply cursor-pointer py-2;
  }
}
</style>
