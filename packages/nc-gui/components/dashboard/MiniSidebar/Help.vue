<script lang="ts" setup>
interface ItemType {
  title: string
  icon?: IconMapKey
  e: string
  link: string
  subItems?: ItemType[]
  onClick?: () => void
  copyBtn?: boolean
  tooltip?: string
  hidden?: boolean
}

interface CategoryItemType {
  category: string
  items: ItemType[]
  hidden?: boolean
}

const { $e } = useNuxtApp()

const { t } = useI18n()

const { isMobileMode } = useGlobal()

const { isWhiteLabelled, config } = useBranding()

const visible = ref(false)

const copyBtnRef = ref()

const helpItems = computed<CategoryItemType[]>(() => {
  const isWl = isWhiteLabelled.value
  const supportEmail = config.value?.supportEmail || ''

  return [
    {
      category: t('general.contactSupport'),
      items: [
        {
          title: supportEmail,
          icon: 'ncMail',
          e: 'c:nocodb:contact-us-mail-copy',
          link: '',
          copyBtn: true,
          tooltip: t('labels.clickToCopy'),
        },
      ],
      // Only a configured white-label contact; there is no default support address.
      hidden: !(isWl && supportEmail),
    },
  ]
})

const openUrl = (item: ItemType) => {
  if (item.e) {
    $e(item.e, {
      trigger: 'mini-sidebar',
    })
  }

  if (item.onClick) {
    item.onClick()
    visible.value = false
  } else if (item.link.startsWith('http')) {
    window.open(item.link, '_blank')
  } else if (item.link) {
    openLinkUsingATag(item.link, '_blank')
  }

  if (item.copyBtn && copyBtnRef.value) {
    copyBtnRef.value?.[0]?.copyContent?.(item.title)
  }
}
</script>

<template>
  <NcDropdown
    v-model:visible="visible"
    placement="rightBottom"
    overlay-class-name="!min-w-55 nc-help-menu-dropdown"
    :align="{ offset: [0, 3] }"
  >
    <slot />

    <template #overlay>
      <NcMenu variant="small">
        <template v-for="(category, idx) of helpItems" :key="idx">
          <template v-if="!category.hidden">
            <NcDivider v-if="idx !== 0" />
            <NcMenuItemLabel>
              <span class="normal-case">
                {{ category.category }}
              </span>
            </NcMenuItemLabel>

            <template v-for="(item, i) of category.items" :key="i">
              <template v-if="!item.hidden">
                <NcSubMenu v-if="item.subItems" class="py-0" variant="small">
                  <template #title>
                    <GeneralIcon v-if="item.icon" :icon="item.icon" class="h-4 w-4" />
                    {{ item.title }}
                  </template>
                  <template v-for="(subItem, j) of item.subItems" :key="j">
                    <NcMenuItem v-if="!subItem.hidden" @click="openUrl(subItem)">
                      <GeneralIcon v-if="subItem.icon" :icon="subItem.icon" class="h-4 w-4" />
                      {{ subItem.title }}
                    </NcMenuItem>
                  </template>
                </NcSubMenu>
                <NcTooltip v-else :title="item.tooltip" :disabled="!item.tooltip || isMobileMode" placement="top" hide-on-click>
                  <NcMenuItem @click="openUrl(item)">
                    <GeneralIcon v-if="item.icon" :icon="item.icon" class="h-4 w-4" />
                    {{ item.title }}

                    <GeneralCopyButton
                      v-if="item.copyBtn"
                      ref="copyBtnRef"
                      type="secondary"
                      :content="item.title"
                      :show-toast="false"
                    />
                  </NcMenuItem>
                </NcTooltip>
              </template>
            </template>
          </template>
        </template>
      </NcMenu>
    </template>
  </NcDropdown>
</template>

<style lang="scss">
.nc-help-menu-dropdown.nc-help-menu-dropdown {
  overflow: visible !important;

  &::before {
    content: '';
    position: absolute;
    left: -6px;
    bottom: 13px;
    width: 0;
    height: 0;
    border-top: 7px solid transparent;
    border-bottom: 7px solid transparent;
    border-right: 7px solid var(--nc-border-gray-medium);
  }

  &::after {
    content: '';
    position: absolute;
    left: -5px;
    bottom: 14px;
    width: 0;
    height: 0;
    border-top: 6px solid transparent;
    border-bottom: 6px solid transparent;
    border-right: 6px solid var(--nc-bg-default);
  }
}
</style>
