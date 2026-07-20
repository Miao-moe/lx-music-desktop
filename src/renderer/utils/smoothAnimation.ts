/**
 * 全局平滑动画系统
 *
 * 启用条件：appSetting['ui.smoothAnimation'] === true
 *
 * 设计原则：
 *   - 仅使用 transform / opacity（GPU 友好，不触发 layout）
 *   - 通过 CSS 变量 --anim-speed 控制全局速率（用户可调）
 *   - 默认使用 cubic-bezier(0.4, 0, 0.2, 1)（Material Design 标准曲线）
 *   - 减弱动画偏好（prefers-reduced-motion）下自动禁用
 *
 * 使用方式：
 *   - 全局挂载后，所有 .smooth-fade / .smooth-slide-up / .smooth-scale 自动生效
 *   - 单个组件可绑定 :class="$style.xxx" 然后继承全局速率
 */

import { watchEffect, onMounted, onBeforeUnmount } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'

const STYLE_ID = 'lx-smooth-anim-style'

const STYLE_CONTENT = `
:root {
  --anim-speed: 1;
  --anim-easing: cubic-bezier(0.4, 0, 0.2, 1);
  --anim-duration-fast: calc(0.2s / var(--anim-speed));
  --anim-duration-normal: calc(0.35s / var(--anim-speed));
  --anim-duration-slow: calc(0.5s / var(--anim-speed));
  --anim-duration-page: calc(0.6s / var(--anim-speed));
}

/* 渐入渐出（弹窗、模态框、Toast） */
.smooth-fade-enter-active,
.smooth-fade-leave-active {
  transition: opacity var(--anim-duration-normal) var(--anim-easing);
}
.smooth-fade-enter-from,
.smooth-fade-leave-to {
  opacity: 0;
}

/* 上滑进入（抽屉、底部弹层、列表项） */
.smooth-slide-up-enter-active,
.smooth-slide-up-leave-active {
  transition:
    transform var(--anim-duration-normal) var(--anim-easing),
    opacity var(--anim-duration-normal) var(--anim-easing);
}
.smooth-slide-up-enter-from,
.smooth-slide-up-leave-to {
  transform: translateY(12px);
  opacity: 0;
}

/* 缩放进入（按钮菜单、缩略图详情） */
.smooth-scale-enter-active,
.smooth-scale-leave-active {
  transition:
    transform var(--anim-duration-fast) var(--anim-easing),
    opacity var(--anim-duration-fast) var(--anim-easing);
}
.smooth-scale-enter-from,
.smooth-scale-leave-to {
  transform: scale(0.92);
  opacity: 0;
}

/* 页面切换（横向滑动） */
.smooth-page-enter-active,
.smooth-page-leave-active {
  transition:
    transform var(--anim-duration-page) var(--anim-easing),
    opacity var(--anim-duration-page) var(--anim-easing);
}
.smooth-page-enter-from {
  transform: translateX(20px);
  opacity: 0;
}
.smooth-page-leave-to {
  transform: translateX(-20px);
  opacity: 0;
}

/* 列表项进入（交错延迟） */
.smooth-list-item {
  animation: smooth-list-item-in calc(0.3s / var(--anim-speed)) var(--anim-easing) both;
}
@keyframes smooth-list-item-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 通用过渡（按钮、悬停态） */
.smooth-hover {
  transition:
    background-color var(--anim-duration-fast) var(--anim-easing),
    color var(--anim-duration-fast) var(--anim-easing),
    border-color var(--anim-duration-fast) var(--anim-easing),
    transform var(--anim-duration-fast) var(--anim-easing),
    box-shadow var(--anim-duration-fast) var(--anim-easing);
}

/* 按钮 hover 提升 */
.smooth-lift:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
.smooth-lift:active {
  transform: translateY(0);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* 进度条平滑过渡 */
.smooth-progress-bar > * {
  transition: width var(--anim-duration-fast) linear;
}

/* 设置面板切换动画 */
.smooth-setting-panel-enter-active,
.smooth-setting-panel-leave-active {
  transition:
    opacity var(--anim-duration-normal) var(--anim-easing),
    transform var(--anim-duration-normal) var(--anim-easing);
}
.smooth-setting-panel-enter-from {
  opacity: 0;
  transform: translateX(10px);
}
.smooth-setting-panel-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

/* 尊重「减少动态」系统偏好 */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`

let styleEl: HTMLStyleElement | null = null
let speedWatcher: (() => void) | null = null

const injectStyle = () => {
  if (styleEl) return
  styleEl = document.createElement('style')
  styleEl.id = STYLE_ID
  styleEl.textContent = STYLE_CONTENT
  document.head.appendChild(styleEl)
}

const removeStyle = () => {
  if (!styleEl) return
  document.head.removeChild(styleEl)
  styleEl = null
}

const updateSpeedVar = () => {
  const speed = appSetting['ui.smoothAnimation']
    ? (appSetting['ui.animationSpeed'] || 1)
    : 0.001 // 接近 0，等价于关闭动画
  document.documentElement.style.setProperty('--anim-speed', String(speed))
}

/**
 * 启动平滑动画系统
 * 在 App.vue setup() 中调用一次即可
 */
export const useSmoothAnimation = () => {
  onMounted(() => {
    updateSpeedVar()
    if (appSetting['ui.smoothAnimation']) {
      injectStyle()
    }
  })

  // 监听开关
  watchEffect(() => {
    if (appSetting['ui.smoothAnimation']) {
      injectStyle()
    } else {
      removeStyle()
    }
    updateSpeedVar()
  })

  // 监听速率变化
  watchEffect(() => {
    updateSpeedVar()
  })

  onBeforeUnmount(() => {
    removeStyle()
  })
}
