<script lang="ts" setup>
import type { TableType } from 'nocodb-sdk'

const { openedProject, isDataSourceLimitReached } = storeToRefs(useBases())

const baseStore = useBase()
const { base } = storeToRefs(baseStore)

const isNewBaseModalOpen = ref(false)

const { isMobileMode } = useGlobal()

const { isUIAllowed, environmentRestrictionReason } = useRoles()

const { $e } = useNuxtApp()

const { t } = useI18n()

const { showEEFeatures, showExternalSourcePlanLimitExceededModal } = useEeConfig()

const { activeSidebarTab } = storeToRefs(useSidebarStore())

const tablesStore = useTablesStore()
const { activeTables } = storeToRefs(tablesStore)

const canCreateTable = computed(() => isUIAllowed('tableCreate', { source: base.value?.sources?.[0] }))

const tabActionLabel = computed(() => {
  const labels: Record<string, string> = {
    workflows: t('objects.workflow'),
    agents: t('objects.agent'),
    docs: t('objects.document'),
  }
  return labels[activeSidebarTab.value] ?? t('general.data')
})

const isImportModalOpen = ref(false)

const defaultBase = computed(() => {
  return openedProject.value?.sources?.[0]
})

function openTableCreateDialog(baseIndex?: number | undefined) {
  $e('c:table:create:navdraw')

  const isOpen = ref(true)
  let sourceId = openedProject.value!.sources?.[0].id
  if (typeof baseIndex === 'number') {
    sourceId = openedProject.value!.sources?.[baseIndex].id
  }

  if (!sourceId || !openedProject.value?.id) return

  const { close } = useDialog(resolveComponent('DlgTableCreate'), {
    'modelValue': isOpen,
    sourceId,
    'baseId': openedProject.value.id,
    'onCreate': closeDialog,
    'onUpdate:modelValue': () => closeDialog(),
  })

  function closeDialog(table?: TableType) {
    isOpen.value = false

    if (!table) return

    // TODO: Better way to know when the table node dom is available
    setTimeout(() => {
      const newTableDom = document.querySelector(`[data-table-id="${table.id}"]`)
      if (!newTableDom) return

      newTableDom?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 1000)

    close(1000)
  }
}

const tableCreateReason = computed(() => environmentRestrictionReason('tableCreate', { source: base.value?.sources?.[0] }))

const onCreateBaseClick = () => {
  if (showExternalSourcePlanLimitExceededModal() || isDataSourceLimitReached.value) return

  isNewBaseModalOpen.value = true
}
</script>

<template>
  <div class="nc-all-tables-view py-4 px-6 nc-scrollbar-thin h-full overflow-y-auto">
    <h2 class="text-subHeading2 text-nc-content-gray-emphasis mb-4 mt-0">{{ tabActionLabel }} {{ $t('labels.actions') }}</h2>

    <div
      class="nc-overview-actions flex flex-row gap-4 flex-wrap max-w-[1000px]"
      :class="{
        'pointer-events-none': base?.isLoading,
      }"
    >
      <template v-if="base?.isLoading">
        <ProjectActionItem v-for="item in 7" :key="item" is-loading label="loading" />
      </template>
      <template v-else>
        <!-- Data actions (shown on Data tab) -->
        <template v-if="activeSidebarTab === 'data'">
          <NcTooltip
            v-if="isUIAllowed('tableCreate', { source: base?.sources?.[0] }) || !!tableCreateReason"
            :title="tableCreateReason ? $t(tableCreateReason) : ''"
            :disabled="!tableCreateReason"
          >
            <ProjectActionItem
              :disabled="!!tableCreateReason"
              :label="$t('dashboards.create_new_table')"
              :subtext="$t('msg.subText.startFromScratch')"
              data-testid="proj-view-btn__add-new-table"
              @click="tableCreateReason ? undefined : openTableCreateDialog()"
            >
              <template #icon>
                <GeneralIcon icon="addOutlineBox" class="!h-6 !w-6" />
              </template>
            </ProjectActionItem>
          </NcTooltip>

          <ProjectActionItem
            v-if="isUIAllowed('tableCreate', { source: base?.sources?.[0] })"
            v-e="['c:table:import']"
            data-testid="proj-view-btn__import-data"
            :label="$t('labels.importData')"
            :subtext="$t('msg.subText.importData')"
            @click="isImportModalOpen = true"
          >
            <template #icon>
              <GeneralIcon icon="download" class="!h-6 !w-6" />
            </template>
          </ProjectActionItem>

          <ProjectActionCreateNewDocument v-if="isEeUI" :base-id="base?.id" />

          <ProjectActionCreateEmptyDashboard v-if="!isMobileMode && showEEFeatures" />

          <ProjectActionCreateNewSync v-if="!isMobileMode && showEEFeatures" :base-id="base?.id" />

          <NcTooltip
            v-if="!isMobileMode && isUIAllowed('sourceCreate')"
            placement="bottom"
            :disabled="!isDataSourceLimitReached"
            class="flex-none flex"
          >
            <template #title>
              {{ $t('tooltip.reachedSourceLimit') }}
            </template>

            <ProjectActionItem
              v-if="!isMobileMode"
              v-e="['c:table:create-source']"
              data-testid="proj-view-btn__create-source"
              :disabled="isDataSourceLimitReached"
              :label="$t('labels.connectDataSource')"
              :subtext="$t('msg.subText.connectExternalData')"
              @click="onCreateBaseClick"
            >
              <template #icon>
                <GeneralIcon icon="server1" class="!h-6 !w-6" />
              </template>
              <template #label>
                <NcTooltip
                  :title="$t('labels.connectDataSource')"
                  :disabled="isDataSourceLimitReached"
                  show-on-truncate-only
                  class="min-w-0 truncate"
                >
                  {{ $t('labels.connectDataSource') }}
                </NcTooltip>
              </template>
            </ProjectActionItem>
          </NcTooltip>
        </template>

        <!-- Automation actions (shown on Automation tab) -->
        <template v-if="activeSidebarTab === 'workflows' && !isMobileMode && showEEFeatures">
          <ProjectActionCreateEmptyWorkflow />
          <ProjectActionCreateEmptyScript />
        </template>
        <!-- Agent actions (shown on Agents tab) -->
        <template v-if="activeSidebarTab === 'agents' && !isMobileMode && showEEFeatures">
          <ProjectActionCreateEmptyAgent />
        </template>
      </template>
    </div>

    <div v-if="!base.isLoading" class="nc-overview-empty-placeholder">
      <NcEmptyPlaceholder :title="$t('msg.noActionsAvailable')" />
    </div>

    <!-- What is already in the base, so the overview is somewhere to start from
         rather than only a set of create buttons. -->
    <section v-if="activeSidebarTab === 'data' && !base?.isLoading" class="nc-overview-tables" data-testid="nc-overview-tables">
      <div class="flex items-center gap-2 mb-3">
        <h2 class="text-subHeading2 text-nc-content-gray-emphasis m-0">{{ $t('objects.tables') }}</h2>
        <span v-if="activeTables.length" class="nc-overview-count">{{ activeTables.length }}</span>
      </div>

      <div v-if="activeTables.length" class="nc-overview-table-list">
        <button
          v-for="table of activeTables"
          :key="table.id"
          type="button"
          class="nc-overview-table-item"
          :data-testid="`nc-overview-table-${table.title}`"
          @click="tablesStore.openTable(table)"
        >
          <span class="nc-overview-table-icon">
            <LazyGeneralEmojiPicker
              v-if="parseProp(table.meta)?.icon"
              :emoji="parseProp(table.meta).icon"
              size="small"
              readonly
            />
            <GeneralIcon v-else-if="table.synced" icon="ncZap" class="h-4 w-4" />
            <GeneralIcon v-else-if="table.type === 'view'" icon="eye" class="h-4 w-4" />
            <GeneralIcon v-else icon="table" class="h-4 w-4" />
          </span>
          <NcTooltip show-on-truncate-only class="truncate flex-1 text-left">
            <template #title>{{ table.title }}</template>
            {{ table.title }}
          </NcTooltip>
          <GeneralIcon icon="chevronRight" class="nc-overview-table-chevron" />
        </button>
      </div>

      <div v-else class="nc-overview-tables-empty">
        <NcEmptyPlaceholder :title="$t('labels.noTablesYet')" :subtitle="$t('labels.overviewNoTablesSubtitle')">
          <template #icon>
            <GeneralIcon icon="table" class="h-6 w-6 text-nc-content-gray-muted" />
          </template>
          <template v-if="canCreateTable && !tableCreateReason" #action>
            <NcButton size="small" type="primary" data-testid="nc-overview-empty-create-table" @click="openTableCreateDialog()">
              <template #icon>
                <GeneralIcon icon="plus" />
              </template>
              {{ $t('dashboards.create_new_table') }}
            </NcButton>
          </template>
        </NcEmptyPlaceholder>
      </div>
    </section>

    <ProjectImportModal v-if="defaultBase" v-model:visible="isImportModalOpen" :source="defaultBase" />
    <LazyDashboardSettingsDataSourcesCreateBase v-if="isNewBaseModalOpen" v-model:open="isNewBaseModalOpen" is-modal />
  </div>
</template>

<style lang="scss" scoped>
.nc-overview-empty-placeholder {
  @apply mt-10;
  display: none;
}

.nc-overview-tables {
  @apply mt-10 max-w-[1000px];
}

.nc-overview-count {
  @apply px-1.5 rounded-md bg-nc-bg-gray-light text-nc-content-gray-subtle2 text-small font-medium leading-5 min-w-5 text-center;
}

.nc-overview-table-list {
  @apply grid gap-2;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}

.nc-overview-table-item {
  @apply flex items-center gap-2.5 h-10 px-3 rounded-lg border-1 border-nc-border-gray-light bg-nc-bg-card text-sm text-nc-content-gray cursor-pointer min-w-0 transition-colors duration-150;
  font-family: inherit;

  .nc-overview-table-icon {
    @apply flex-none flex items-center justify-center w-4 h-4 text-nc-content-gray-muted;
  }

  .nc-overview-table-chevron {
    @apply flex-none h-4 w-4 text-nc-content-gray-muted opacity-0 transition-opacity duration-150;
  }

  &:hover {
    @apply border-nc-border-gray-medium text-nc-content-gray-emphasis;
    background-color: var(--nc-bg-card-hover);

    .nc-overview-table-chevron {
      @apply opacity-100;
    }
  }
}

.nc-overview-tables-empty {
  @apply rounded-xl border-1 border-dashed border-nc-border-gray-medium py-10 px-6;
}

.nc-overview-actions:empty ~ .nc-overview-empty-placeholder {
  display: block;
}
</style>
