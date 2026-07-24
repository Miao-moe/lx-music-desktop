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
      base-btn.btn(min :disabled="loginBusy(item.id)" @click="handleLogin(item)") {{ loginBusy(item.id) ? $t('setting__cookie_login_running') : $t('setting__cookie_login') }}
      base-btn.btn(min @click="handleClear(item.id)") {{ $t('setting__cookie_clear') }}
      span(v-if="appSetting[item.settingKey]" :style="{ color: isValid(item.id) ? 'var(--color-primary)' : 'var(--color-font-label)', fontSize: '12px' }")
        | {{ isValid(item.id) ? $t('setting__cookie_status_valid') : $t('setting__cookie_status_invalid') }}
      span(v-if="loginTip(item.id)" :style="{ color: loginError(item.id) ? 'var(--color-font-label)' : 'var(--color-primary)', fontSize: '12px' }") {{ loginTip(item.id) }}

</template>

<script>
import { reactive, ref } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, updateSetting } from '@renderer/store/setting'
import {
  SOURCE_NAME,
  isCookieValid,
} from '@renderer/utils/cookieManager'
import { syncAllPlaylists, syncCookiePlaylists } from '@renderer/utils/cookieSync'
import { loginCookie } from '@renderer/utils/ipc'

export default {
  name: 'SettingCookie',
  setup() {
    const t = useI18n()

    const sources = [
      { id: 'wy', name: SOURCE_NAME.wy, settingKey: 'cookie.wy', placeholder: 'MUSIC_U=xxx; __csrf=xxx; ...' },
      { id: 'tx', name: SOURCE_NAME.tx, settingKey: 'cookie.tx', placeholder: 'uin=xxx; qqmusic_key=xxx; ...' },
      { id: 'kg', name: SOURCE_NAME.kg, settingKey: 'cookie.kg', placeholder: 'kg_mid=xxx; kg_user_v=xxx; ...' },
      { id: 'kw', name: SOURCE_NAME.kw, settingKey: 'cookie.kw', placeholder: 'kw_token=xxx; Hm_lvt_xxx=xxx; ...' },
      { id: 'mg', name: SOURCE_NAME.mg, settingKey: 'cookie.mg', placeholder: 'migu_music_sid=xxx; USER_ID=xxx; ...' },
    ]

    const isValid = (id) => isCookieValid(id)

    const cookieSaveTimers = new Map()

    const saveCookie = (key, value) => {
      const timer = cookieSaveTimers.get(key)
      if (timer) clearTimeout(timer)
      cookieSaveTimers.set(key, setTimeout(() => {
        cookieSaveTimers.delete(key)
        updateSetting({ [key]: value.trim() })
      }, 400))
    }

    const handleCookieChange = (id, value) => {
      const item = sources.find(s => s.id === id)
      if (!item) return
      appSetting[item.settingKey] = value
      saveCookie(item.settingKey, value)
    }

    const handleClear = async(id) => {
      const item = sources.find(s => s.id === id)
      if (!item) return
      const timer = cookieSaveTimers.get(item.settingKey)
      if (timer) {
        clearTimeout(timer)
        cookieSaveTimers.delete(item.settingKey)
      }
      appSetting[item.settingKey] = ''
      updateSetting({ [item.settingKey]: '' })
    }

    const loginStates = reactive({})
    const loginBusy = (id) => loginStates[id]?.busy === true
    const loginTip = (id) => loginStates[id]?.tip ?? ''
    const loginError = (id) => loginStates[id]?.error === true

    const handleLogin = async(item) => {
      if (loginBusy(item.id)) return
      loginStates[item.id] = { busy: true, tip: '', error: false }
      try {
        const { cookie, playlists } = await loginCookie(item.id)
        appSetting[item.settingKey] = cookie
        updateSetting({ [item.settingKey]: cookie })
        loginStates[item.id] = { busy: false, tip: t('setting__cookie_login_done'), error: false }
        const result = await syncCookiePlaylists(item.id, playlists)
        if (result.synced) {
          loginStates[item.id] = {
            busy: false,
            tip: t('setting__cookie_sync_now_done', { list: String(result.listCount), count: String(result.count) }),
            error: false,
          }
        } else if (result.error) {
          loginStates[item.id] = { busy: false, tip: t('setting__cookie_sync_now_failed'), error: true }
        }
      } catch {
        loginStates[item.id] = { busy: false, tip: t('setting__cookie_login_failed'), error: true }
      }
    }

    const syncing = ref(false)
    const syncTip = ref('')
    const syncError = ref(false)

    const SOURCE_SHORT = { wy: '网易云', tx: 'QQ', kg: '酷狗', kw: '酷我', mg: '咪咕' }

    const buildSyncTip = (details = []) => {
      if (!details.length) return ''
      return details.map((d) => {
        const name = SOURCE_SHORT[d.source] ?? d.source
        if (d.status === 'success') {
          return d.listCount > 0
            ? `${name}✓(${d.listCount}/${d.count})`
            : `${name}✓`
        }
        return `${name}✗`
      }).join('  ')
    }

    const handleSyncNow = async() => {
      if (syncing.value) return
      syncing.value = true
      syncTip.value = ''
      syncError.value = false
      try {
        const result = await syncAllPlaylists()
        if (!result.synced) {
          syncError.value = true
          syncTip.value = result.details?.length ? buildSyncTip(result.details) : t('setting__cookie_sync_now_skipped')
        } else {
          syncTip.value = buildSyncTip(result.details)
          syncError.value = !!result.error
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
      loginBusy,
      loginTip,
      loginError,
      handleLogin,
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
