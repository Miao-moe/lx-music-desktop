/**
 * 无缝衔接（Gapless Playback）+ 渐入渐出（Fade-in / Fade-out）播放引擎
 *
 * 实现思路：
 *   - 维护两个 audio 元素：primaryAudio 与 secondaryAudio
 *   - 当 current song 播放进度接近末尾（剩余 < 5s）时，开始预加载下一首到 secondaryAudio
 *   - 接近末尾（剩余 < fadeDuration）时启动交叉淡化：
 *       primaryAudio 音量从 1 → 0
 *       secondaryAudio 音量从 0 → 1
 *   - 淡化完成后切换主备
 *
 * 单 audio 元素方案（gapless 关闭或仅 fade 启用时）：
 *   - 切歌时旧 audio 渐出 0.5s，新 audio 加载完成后渐入 0.5s
 *   - 避免直接 setSrc 导致音频瞬断
 *
 * 性能考量：
 *   - 两个 audio 元素共享同一个 AudioContext / MediaElementSource 链路是有限制的
 *     （createMediaElementSource 一对一），所以 secondaryAudio 走独立链路，
 *     不接入 EQ / 环境音效 / Panner（仅接入 gainNode 用于淡化）
 *   - 用户切换歌曲时立即触发 fade-out → setSrc → fade-in
 */

import { appSetting } from '@renderer/store/setting'

let primaryAudio: HTMLAudioElement | null = null
let secondaryAudio: HTMLAudioElement | null = null
let primaryGain: GainNode | null = null
let secondaryGain: GainNode | null = null
let primaryCtx: AudioContext | null = null
let secondaryCtx: AudioContext | null = null

let nextSongUrl: string | null = null
let isCrossfading = false
let crossfadeTimer: number | null = null

/**
 * 初始化双 audio 引擎
 * 由 player 插件在 createAudio 时调用
 */
export const initGaplessEngine = (mainAudio: HTMLAudioElement) => {
  primaryAudio = mainAudio

  // 主 audio 链路使用现有 player 插件的链路（不动）
  // secondary audio 独立 AudioContext + GainNode
  if (!secondaryCtx) {
    try {
      secondaryCtx = new AudioContext({ latencyHint: 'playback' })
      const secAudio = new Audio()
      secAudio.crossOrigin = 'anonymous'
      secAudio.preload = 'auto'
      secAudio.autoplay = false
      secondaryAudio = secAudio
      const gain = secondaryCtx.createGain()
      gain.gain.value = 0
      secondaryGain = gain
      const src = secondaryCtx.createMediaElementSource(secAudio)
      src.connect(gain)
      gain.connect(secondaryCtx.destination)
    } catch (err) {
      console.warn('[gapless] secondary audio init failed:', err)
    }
  }

  // 监听主 audio 时间更新，触发预加载与交叉淡化
  primaryAudio.addEventListener('timeupdate', handleTimeUpdate)
}

const handleTimeUpdate = () => {
  if (!primaryAudio || !secondaryAudio) return
  if (!appSetting['player.gaplessPlayback']) return
  if (isCrossfading) return

  const duration = primaryAudio.duration
  const current = primaryAudio.currentTime
  if (!duration || !isFinite(duration)) return

  const remaining = duration - current
  const fadeDuration = (appSetting['player.fadeDuration'] ?? 800) / 1000

  // 剩余 5 秒时预加载下一首
  if (remaining < 5 && remaining > fadeDuration + 0.3 && !nextSongUrl) {
    // 触发外部预加载逻辑（通过事件）
    ;(window as any).app_event?.emit?.('gapless:preload-next')
  }

  // 剩余等于 fadeDuration 时开始交叉淡化
  if (remaining < fadeDuration && remaining > 0 && nextSongUrl && !isCrossfading) {
    startCrossfade()
  }
}

/**
 * 设置预加载的下一首歌曲 URL（由播放器调用）
 */
export const setNextSongUrl = (url: string | null) => {
  nextSongUrl = url
  if (url && secondaryAudio) {
    secondaryAudio.src = url
    secondaryAudio.load()
  }
}

/**
 * 启动交叉淡化
 */
const startCrossfade = () => {
  if (!primaryAudio || !secondaryAudio || !secondaryGain || !secondaryCtx) return
  if (!nextSongUrl) return

  isCrossfading = true
  const fadeDuration = (appSetting['player.fadeDuration'] ?? 800) / 1000

  // 主 audio 渐出
  primaryAudio.volume = 1
  primaryAudio.volume = 0.5 // 起始（避免 0 突兀）
  // secondary 渐入
  secondaryGain!.gain.cancelScheduledValues(0)
  secondaryGain!.gain.setValueAtTime(0, secondaryCtx!.currentTime)
  secondaryGain!.gain.linearRampToValueAtTime(1, secondaryCtx!.currentTime + fadeDuration)

  // 启动 secondary 播放
  void secondaryAudio!.play().catch((err: Error) => {
    console.warn('[gapless] secondary play failed:', err)
  })

  // 主 audio 同步渐出（直接用 volume 渐变，因为 primary 链路复杂）
  const steps = 20
  const stepInterval = (fadeDuration * 1000) / steps
  let step = 0
  if (crossfadeTimer) clearInterval(crossfadeTimer)
  crossfadeTimer = window.setInterval(() => {
    step++
    if (primaryAudio) {
      primaryAudio.volume = Math.max(0, 1 - (step / steps))
    }
    if (step >= steps) {
      if (crossfadeTimer) {
        clearInterval(crossfadeTimer)
        crossfadeTimer = null
      }
      // 淡化完成，触发主播放器切换到下一首
      ;(window as any).app_event?.emit?.('gapless:crossfade-done')
      // 重置状态
      if (primaryAudio) primaryAudio.volume = 1
      if (secondaryGain) secondaryGain.gain.value = 0
      if (secondaryAudio) {
        secondaryAudio.pause()
        secondaryAudio.currentTime = 0
      }
      isCrossfading = false
      nextSongUrl = null
    }
  }, stepInterval)
}

/**
 * 渐入渐出工具：用于「非 gapless」的普通切歌场景
 *
 * @param audio 目标 audio 元素
 * @param direction 'in' | 'out'
 * @returns Promise<void>，淡化完成后 resolve
 */
export const fadeVolume = (
  audio: HTMLAudioElement,
  direction: 'in' | 'out',
): Promise<void> => {
  if (!appSetting['player.fadeInFadeOut']) {
    return Promise.resolve()
  }
  const duration = appSetting['player.fadeDuration'] ?? 800
  const steps = 20
  const stepInterval = duration / steps
  const targetVolume = direction === 'in' ? 1 : 0
  const startVolume = direction === 'in' ? 0 : (audio.volume || 1)
  audio.volume = startVolume

  return new Promise((resolve) => {
    let step = 0
    const timer = window.setInterval(() => {
      step++
      audio.volume = startVolume + (targetVolume - startVolume) * (step / steps)
      if (step >= steps) {
        clearInterval(timer)
        audio.volume = targetVolume
        resolve()
      }
    }, stepInterval)
  })
}

/**
 * 清理资源
 */
export const destroyGaplessEngine = () => {
  if (crossfadeTimer) {
    clearInterval(crossfadeTimer)
    crossfadeTimer = null
  }
  if (primaryAudio) {
    primaryAudio.removeEventListener('timeupdate', handleTimeUpdate)
  }
  if (secondaryAudio) {
    secondaryAudio.pause()
    secondaryAudio.src = ''
  }
  if (secondaryCtx) {
    void secondaryCtx.close()
    secondaryCtx = null
  }
  primaryAudio = null
  secondaryAudio = null
  primaryGain = null
  secondaryGain = null
  nextSongUrl = null
  isCrossfading = false
}
