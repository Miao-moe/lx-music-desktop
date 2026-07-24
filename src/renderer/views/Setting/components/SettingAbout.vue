<template lang="pug">
dt#about {{ $t('setting__about') }}
dd
  .p.small
    | 开源地址：
    span.hover.underline(:aria-label="$t('setting__click_open')" @click="openUrl('https://github.com/Miao-moe/lx-Miao-moe-music-desktop')") https://github.com/Miao-moe/lx-Miao-moe-music-desktop
  .p.small(style="margin-top: 12px; color: var(--color-500); line-height: 1.8;")
    | {{ $t('setting__about_license') }}
  .p.small(style="color: var(--color-500); line-height: 1.8;")
    | {{ $t('setting__about_based_on') }}
</template>

<script>
import { openUrl } from '@common/utils/electron'

export default {
  name: 'SettingAbout',
  setup() {
    return {
      openUrl,
    }
  },
}
</script>
