<template lang="pug">
dt#advanced {{ $t('setting__advanced') }}
dd
  p.p.gap-top(style="color: var(--color-500); font-size: 12px; line-height: 1.6;")
    | {{ $t('setting__advanced_desc') }}
  p.p.gap-top(style="color: var(--color-500); font-size: 12px; line-height: 1.6;")
    | {{ $t('setting__advanced_nav_tip') }}

dd
  h3#advanced_ui {{ $t('setting__advanced_ui') }}
  div
    .gap-top
      base-checkbox(
        id="setting_advanced_ui_smooth_anim"
        :model-value="appSetting['ui.smoothAnimation']"
        :label="$t('setting__advanced_ui_smooth_anim')"
        @update:model-value="updateSetting({ 'ui.smoothAnimation': $event })"
      )
      svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__advanced_ui_smooth_anim_tip')")

dd
    .p.gap-top
      span(style="display: inline-block; width: 130px;") {{ $t('setting__advanced_ui_anim_speed') }}
      svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__advanced_ui_anim_speed_tip')")
      span(style="margin-left: 8px; color: var(--color-500); font-size: 12px;") {{ appSetting['ui.animationSpeed'] }}x
      base-slider-bar(
        :value="appSetting['ui.animationSpeed']"
        :min="0.5" :max="1.5" :step="0.1"
        style="display: inline-block; width: 200px; vertical-align: middle; margin-left: 12px;"
        @change="updateSetting({ 'ui.animationSpeed': $event })"
      )

dd
  h3#advanced_play {{ $t('setting__advanced_play') }}
  div
    .gap-top
      base-checkbox(
        id="setting_advanced_play_gapless"
        :model-value="appSetting['player.gaplessPlayback']"
        :label="$t('setting__advanced_play_gapless')"
        @update:model-value="updateSetting({ 'player.gaplessPlayback': $event })"
      )
      svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__advanced_play_gapless_tip')")
    .gap-top
      base-checkbox(
        id="setting_advanced_play_fade"
        :model-value="appSetting['player.fadeInFadeOut']"
        :label="$t('setting__advanced_play_fade')"
        @update:model-value="updateSetting({ 'player.fadeInFadeOut': $event })"
      )
      svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__advanced_play_fade_tip')")
    .p.gap-top(v-if="appSetting['player.fadeInFadeOut']")
      span(style="display: inline-block; width: 130px;") {{ $t('setting__advanced_play_fade_duration') }}
      svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__advanced_play_fade_duration_tip')")
      span(style="margin-left: 8px; color: var(--color-500); font-size: 12px;") {{ appSetting['player.fadeDuration'] }} ms
      base-slider-bar(
        :value="appSetting['player.fadeDuration']"
        :min="100" :max="3000" :step="100"
        style="display: inline-block; width: 200px; vertical-align: middle; margin-left: 12px;"
        @change="updateSetting({ 'player.fadeDuration': $event })"
      )

</template>

<script>
import { appSetting, updateSetting } from '@renderer/store/setting'

export default {
  name: 'SettingAdvanced',
  setup() {
    return {
      appSetting,
      updateSetting,
    }
  },
}
</script>
