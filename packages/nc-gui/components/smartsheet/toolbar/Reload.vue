<script setup lang="ts">
import type { WatchHandle } from 'vue'

const { $e, $state } = useNuxtApp()

const { isPaginationLoading } = storeToRefs(useViewsStore())
const reloadHook = inject(ReloadViewDataHookInj)!

const isReloading = ref(false)

const onClick = () => {
  $e('a:table:reload:navbar')
  // watch first so a very fast reload is still tracked
  const stop: WatchHandle = watch($state.isLoading, (isLoading) => {
    if (!isLoading) {
      isReloading.value = false
      stop?.()
    }
  })
  isReloading.value = true
  reloadHook.trigger()
}

watch(isReloading, () => {
  isPaginationLoading.value = isReloading.value
})
</script>

<template>
  <NcTooltip placement="bottom">
    <template #title> {{ $t('general.reload') }} </template>

    <button
      type="button"
      class="nc-reload-btn flex ml-1 p-0 border-0 bg-transparent items-center justify-center select-none cursor-pointer text-nc-content-gray-muted w-6 h-6 hover:(bg-nc-bg-gray-light text-nc-content-gray-extreme) rounded-md transition-colors duration-150"
      :aria-label="$t('general.reload')"
      @click="onClick"
    >
      <component :is="iconMap.reload" class="h-4 nc-icon-reload" :class="isReloading ? 'animate-spin' : ''" />
    </button>
  </NcTooltip>
</template>
