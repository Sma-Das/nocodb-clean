<script lang="ts" setup>
const { isWhiteLabelled, faviconUrl, productName, config } = useBranding()

const onClick = () => {
  const url = config.value?.email?.footerUrl
  if (url) openLink(url)
}
</script>

<template>
  <div
    v-if="isWhiteLabelled"
    class="flex items-center gap-3 text-gray-700 dark:text-slate-300"
    :class="{ 'cursor-pointer': !!config?.email?.footerUrl }"
    @click="onClick"
  >
    <!-- Square slot — match NocoDB's square footer icon: use the favicon, not the wide logo. -->
    <img v-if="faviconUrl" :src="faviconUrl" :alt="productName" class="w-7 h-7 object-contain -my-0.5" />
    <div class="text-sm">{{ productName }} Forms</div>
  </div>
</template>
