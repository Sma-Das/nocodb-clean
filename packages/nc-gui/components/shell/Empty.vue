<script lang="ts" setup>
// The one empty state for a shell list pane: glyph and one line. No action --
// every pane that has a primary action already offers it in the header, and
// repeating it in the middle of the pane gave the screen two identical buttons.
// Panes pass a different line for "nothing here yet" and "nothing matched".
interface Props {
  title: string
  icon?: IconMapKey
}

withDefaults(defineProps<Props>(), {
  icon: 'ncInbox',
})
</script>

<template>
  <div class="nc-shell-empty px-2 py-6 flex flex-col items-center gap-3 text-center" data-testid="nc-shell-empty">
    <GeneralEmptyGlyph :icon="icon" />
    <div class="max-w-md text-bodyDefaultSm text-nc-content-gray-subtle2">{{ title }}</div>
  </div>
</template>
