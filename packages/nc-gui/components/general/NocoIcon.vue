<script lang="ts" setup>
interface Props {
  size?: number
}

const props = withDefaults(defineProps<Props>(), {
  size: 64,
})

const { size } = toRefs(props)

const { isDark } = useTheme()

const { isWhiteLabelled, productName, logoUrl, logoDarkUrl, faviconUrl } = useBranding()

// Prefer the favicon (typically square — close to the icon shape we replace);
// fall back to the dark/light logo when a favicon isn't configured.
const brandIcon = computed(() => {
  if (!isWhiteLabelled.value) return null
  return faviconUrl.value || (isDark.value ? logoDarkUrl.value || logoUrl.value : logoUrl.value)
})
</script>

<template>
  <div :style="{ left: `calc(50% - ${size / 2}px)`, top: `-${size / 2}px` }" class="absolute">
    <img v-if="brandIcon" :width="size" :height="size" :alt="productName" :src="brandIcon" class="object-contain" />
    <img v-else-if="isDark" :width="size" :height="size" :alt="productName" src="~/assets/img/icons/256x256-trans.png" />
    <img v-else :width="size" :height="size" :alt="productName" src="~/assets/img/icons/256x256.png" />
  </div>
</template>
