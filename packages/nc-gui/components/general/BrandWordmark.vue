<script setup lang="ts">
const { productName } = useBranding()
</script>

<template>
  <div class="nc-brand-wordmark inline-flex items-center gap-2 select-none">
    <GeneralNocodbLogo class="!h-7 !w-7 flex-none" />
    <span class="text-lg font-semibold tracking-tight text-nc-content-gray-emphasis">{{ productName }}</span>
  </div>
</template>
