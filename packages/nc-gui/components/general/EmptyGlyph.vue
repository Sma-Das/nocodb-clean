<script lang="ts" setup>
// The picture for an empty or no-results state: one quiet glyph in a chip.
//
// Small on purpose. It sits in dropdowns and list panes where a large
// illustration pushed the one line that matters -- what is missing, and what to
// do about it -- below the fold. The text beside it carries the meaning, so the
// glyph is hidden from assistive tech.
interface Props {
  icon?: IconMapKey
  size?: 'small' | 'medium'
}

withDefaults(defineProps<Props>(), {
  icon: 'search',
  size: 'medium',
})
</script>

<template>
  <div class="nc-empty-glyph flex-none" :class="`nc-empty-glyph-${size}`" aria-hidden="true">
    <GeneralIcon :icon="icon" class="nc-empty-glyph-icon" />
  </div>
</template>

<style lang="scss" scoped>
.nc-empty-glyph {
  @apply flex items-center justify-center rounded-xl border-1 border-nc-border-gray-medium bg-nc-bg-gray-extralight text-nc-content-gray-muted;

  &.nc-empty-glyph-medium {
    @apply h-12 w-12;

    .nc-empty-glyph-icon {
      @apply h-5 w-5;
    }
  }

  &.nc-empty-glyph-small {
    @apply h-9 w-9 rounded-lg;

    .nc-empty-glyph-icon {
      @apply h-4 w-4;
    }
  }
}
</style>
