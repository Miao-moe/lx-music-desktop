<template lang="pug">
div(v-if="enabled" :class="$style.dynamicBg")
  div(
    :class="$style.bgLayer"
    :style="bgLayerStyle"
  )
  div(:class="$style.overlay")
</template>

<script>
import { computed } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'
import { playMusicInfo } from '@renderer/store/player/state'

/**
 * 动态背景组件
 *
 * 基于当前播放歌曲的专辑封面生成动态毛玻璃背景：
 *   - 取封面图作为底图，使用 background-image + background-size: cover 填满整个窗口
 *   - 通过 filter: blur() + transform: scale() 实现高斯模糊边缘溢出
 *   - 通过 brightness/opacity 控制明暗，保证前景内容对比度
 *   - 切歌时通过 CSS transition 平滑过渡（过渡时间随「动画速率」变化）
 *
 * 性能优化：
 *   - 使用 will-change: background-image 提前合成层
 *   - 使用 transform 而非 width/height 避免触发布局
 *   - 关闭动态背景时直接 v-if 卸载，不留 DOM
 */
export default {
  name: 'DynamicBackground',
  setup() {
    const enabled = computed(() => appSetting['ui.dynamicBackground'])

    const bgLayerStyle = computed(() => {
      const blur = appSetting['ui.backgroundBlur'] ?? 60
      const brightness = (appSetting['ui.backgroundBrightness'] ?? 35) / 100
      const speed = appSetting['ui.animationSpeed'] || 1
      // 注意：playMusicInfo.musicInfo 可能为 null（未播放时）
      // 真实图片字段是 .pic 而不是 .img
      const imgUrl = playMusicInfo.musicInfo?.pic || playMusicInfo.musicInfo?.img || ''
      return {
        backgroundImage: imgUrl ? `url("${imgUrl}")` : 'none',
        filter: `blur(${blur}px) brightness(${brightness})`,
        transform: 'scale(1.15)', // 防止模糊后边缘露出
        transition: `background-image ${(1.2 / speed).toFixed(2)}s ease-in-out, filter ${(0.5 / speed).toFixed(2)}s ease`,
        willChange: 'background-image, filter',
      }
    })

    return {
      enabled,
      bgLayerStyle,
    }
  },
}
</script>

<style lang="less" module>
.dynamic-bg {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
  background-color: var(--color-main-background);
}

.bg-layer {
  position: absolute;
  top: -10%;
  left: -10%;
  width: 120%;
  height: 120%;
  background-size: cover;
  background-position: center center;
  background-repeat: no-repeat;
  background-color: var(--color-main-background);
}

.overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.05) 0%,
    rgba(0, 0, 0, 0.18) 100%
  );
  backdrop-filter: blur(0px); // 触发合成层
}
</style>
