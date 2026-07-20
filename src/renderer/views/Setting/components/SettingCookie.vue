<template lang="pug">
dt#cookie {{ $t('setting__cookie') }}
dd
  p.p.gap-top(style="color: var(--color-500); font-size: 12px; line-height: 1.6;")
    | {{ $t('setting__cookie_desc') }}
dd
  h3#cookie_sync {{ $t('setting__cookie_sync') }}
  div
    .gap-top
      base-checkbox(
        id="setting_cookie_enable_play_history_sync"
        :model-value="appSetting['cookie.enablePlayHistorySync']"
        :label="$t('setting__cookie_sync_play_history')"
        @update:model-value="updateSetting({ 'cookie.enablePlayHistorySync': $event })"
      )
      svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__cookie_sync_play_history_tip')")
    .gap-top
      base-checkbox(
        id="setting_cookie_enable_fav_list_sync"
        :model-value="appSetting['cookie.enableFavListSync']"
        :label="$t('setting__cookie_sync_fav_list')"
        @update:model-value="updateSetting({ 'cookie.enableFavListSync': $event })"
      )
      svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__cookie_sync_fav_list_tip')")
    .p.gap-top(style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;")
      base-btn.btn(min :disabled="syncing" @click="handleSyncNow") {{ syncing ? $t('setting__cookie_sync_now_running') : $t('setting__cookie_sync_now') }}
      span(v-if="syncTip" :style="{ color: syncError ? 'var(--color-font-label)' : 'var(--color-primary)', fontSize: '12px' }") {{ syncTip }}

dd(v-for="item in sources" :key="item.id")
  h3(:id="`cookie_${item.id}`") {{ item.name }}
  div
    .p
      textarea(
        :class="$style.cookieInput"
        :value="appSetting[item.settingKey]"
        :placeholder="item.placeholder"
        rows="3"
        spellcheck="false"
        @input="handleCookieChange(item.id, $event.target.value)"
      )
    .p(style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;")
      base-btn.btn(min @click="handleClear(item.id)") {{ $t('setting__cookie_clear') }}
      base-btn.btn(min @click="handleOpenWebsite(item)") {{ $t('setting__cookie_open_website') }}
      span(v-if="appSetting[item.settingKey]" :style="{ color: isValid(item.id) ? 'var(--color-primary)' : 'var(--color-font-label)', fontSize: '12px' }")
        | {{ isValid(item.id) ? $t('setting__cookie_status_valid') : $t('setting__cookie_status_invalid') }}

</template>

<script>
import { ref } from '@common/utils/vueTools'
import { debounce } from '@common/utils'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, updateSetting } from '@renderer/store/setting'
import {
  SOURCE_DOMAIN,
  SOURCE_NAME,
  isCookieValid,
} from '@renderer/utils/cookieManager'
import { syncWyPlaylists } from '@renderer/utils/cookieSync'
import { openUrl } from '@common/utils/electron'

export default {
  name: 'SettingCookie',
  setup() {
    const t = useI18n()

    const sources = [
      { id: 'wy', name: SOURCE_NAME.wy, domain: SOURCE_DOMAIN.wy, settingKey: 'cookie.wy', placeholder: 'MUSIC_U=xxx; __csrf=xxx; ...' },
      { id: 'tx', name: SOURCE_NAME.tx, domain: SOURCE_DOMAIN.tx, settingKey: 'cookie.tx', placeholder: 'uin=xxx; qqmusic_key=xxx; ...' },
      { id: 'kg', name: SOURCE_NAME.kg, domain: SOURCE_DOMAIN.kg, settingKey: 'cookie.kg', placeholder: 'kg_mid=xxx; kg_user_v=xxx; ...' },
      { id: 'kw', name: SOURCE_NAME.kw, domain: SOURCE_DOMAIN.kw, settingKey: 'cookie.kw', placeholder: 'kw_token=xxx; Hm_lvt_xxx=xxx; ...' },
      { id: 'mg', name: SOURCE_NAME.mg, domain: SOURCE_DOMAIN.mg, settingKey: 'cookie.mg', placeholder: 'migu_music_sid=xxx; USER_ID=xxx; ...' },
      { id: 'bili', name: SOURCE_NAME.bili, domain: SOURCE_DOMAIN.bili, settingKey: 'cookie.bili', placeholder: 'SESSDATA=xxx; bili_jct=xxx; ...' },
    ]

    const isValid = (id) => isCookieValid(id)

    const saveCookie = debounce((key, value) => {
      updateSetting({ [key]: value.trim() })
    }, 400)

    const handleCookieChange = (id, value) => {
      const item = sources.find(s => s.id === id)
      if (!item) return
      saveCookie(item.settingKey, value)
    }

    const handleClear = (id) => {
      const item = sources.find(s => s.id === id)
      if (!item) return
      updateSetting({ [item.settingKey]: '' })
    }

    const handleOpenWebsite = (item) => {
      void openUrl(`https://${item.domain}`)
    }

    // —— 立即同步（网易云「我喜欢」及所有自建歌单）——
    const syncing = ref(false)
    const syncTip = ref('')
    const syncError = ref(false)

    const handleSyncNow = async() => {
      if (syncing.value) return
      syncing.value = true
      syncTip.value = ''
      syncError.value = false
      try {
        const result = await syncWyPlaylists()
        if (result.error) {
          syncError.value = true
          syncTip.value = t('setting__cookie_sync_now_failed')
        } else if (!result.synced) {
          syncError.value = true
          syncTip.value = result.message ?? t('setting__cookie_sync_now_skipped')
        } else {
          syncTip.value = t('setting__cookie_sync_now_done', { list: String(result.listCount), count: String(result.count) })
        }
      } catch {
        syncError.value = true
        syncTip.value = t('setting__cookie_sync_now_failed')
      } finally {
        syncing.value = false
      }
    }

    return {
      appSetting,
      updateSetting,
      sources,
      isValid,
      handleCookieChange,
      handleClear,
      handleOpenWebsite,
      syncing,
      syncTip,
      syncError,
      handleSyncNow,
    }
  },
}
</script>

<style lang="less" module>
.cookieInput {
  width: 100%;
  min-height: 60px;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid var(--color-primary-light-200-alpha-700);
  background-color: var(--color-main-background);
  color: var(--color-font);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  transition: border-color 0.2s ease;

  &:focus {
    border-color: var(--color-primary);
  }

  &::placeholder {
    color: var(--color-font-label);
  }
}
</style>
