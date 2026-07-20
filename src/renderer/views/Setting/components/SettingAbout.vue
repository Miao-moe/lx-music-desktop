<template lang="pug">
dt#about {{ $t('setting__about') }}
dd
  .p.small
    | 开源地址：
    span.hover.underline(:aria-label="$t('setting__click_open')" @click="openUrl('https://github.com/Miao-moe/lx-Miao-moe-music-desktop')") https://github.com/Miao-moe/lx-Miao-moe-music-desktop
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
