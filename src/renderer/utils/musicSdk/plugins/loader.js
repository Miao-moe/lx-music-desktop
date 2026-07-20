/**
 * 扩展音源插件加载器
 *
 * 设计目标：把「易失效、有合规风险」的扩展音源（如需要平台专有接口/签名的音源）
 * 从主程序中解耦出去，使主仓库保持一个「干净的播放器」。
 *
 * 加载来源：
 *   1. 本地插件：window.__lxExtSourcePlugins__.locals 指定的工厂函数
 *      —— 在 musicSdk 顶层「同步」注册，保证各 store 顶层遍历 music.sources 时即可见
 *   2. 远程插件：window.__lxExtSourcePlugins__.remotes 指定的 URL 列表
 *      —— 在 init() 阶段「异步」拉取脚本文本并在受控作用域执行，接口失效时只需更新远程脚本，无需发版
 *
 * 插件契约（每个插件是一个「工厂函数」，接收注入的运行环境，返回音源定义）：
 *
 *   module.exports = function createPlugin(env) {
 *     // env: { httpFetch, crypto, utils }
 *     return {
 *       id: 'xxx',                 // 音源唯一标识
 *       name: '示例音源',           // 显示名称
 *       // 与内置音源相同的方法契约：
 *       musicSearch: { search(keyword, page, limit) {} },
 *       getMusicUrl(songInfo, type) { return { promise, cancelHttp } },
 *       getLyric(songInfo) { return { promise, cancelHttp } },
 *       getPic(songInfo) { return { promise, cancelHttp } },
 *       getMusicDetailPageUrl(songInfo) { return '' },
 *     }
 *   }
 *
 * 注意：插件不直接 import 主仓库内部模块，所有能力均通过 env 注入，
 *       从而保证「插件」与「主程序」彻底解耦、可独立分发/更新。
 */

import { httpFetch } from '../../request'
import cryptojs from 'crypto-js'

const REMOTE_TIMEOUT = 10000

/**
 * 注入给插件的运行环境。
 * 只暴露通用能力，不暴露主仓库内部实现细节。
 */
const buildPluginEnv = () => {
  return {
    httpFetch,
    // 轻量加密工具，避免插件自带庞大依赖
    crypto: {
      md5(str) {
        return cryptojs.MD5(str).toString()
      },
    },
    utils: {
      formatPlayTime(sec) {
        if (!sec || isNaN(sec)) return '00:00'
        const m = Math.floor(sec / 60).toString().padStart(2, '0')
        const s = Math.floor(sec % 60).toString().padStart(2, '0')
        return `${m}:${s}`
      },
    },
  }
}

/**
 * 在受控作用域内执行远程插件文本，得到工厂函数。
 * 远程脚本以 CommonJS 形式书写（module.exports = factory）。
 */
const evalRemotePlugin = (code) => {
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  const runner = new Function('module', 'exports', code)
  runner(module, module.exports)
  const factory = typeof module.exports === 'function' ? module.exports : module.exports.default
  if (typeof factory !== 'function') throw new Error('plugin must export a factory function')
  return factory
}

const fetchRemotePlugin = async(url) => {
  const req = httpFetch(url, { method: 'get', format: 'text', timeout: REMOTE_TIMEOUT })
  const { body, statusCode } = await req.promise
  if (statusCode !== 200) throw new Error(`plugin fetch failed (${statusCode})`)
  const code = typeof body === 'string' ? body : String(body ?? '')
  if (!code.trim()) throw new Error('empty plugin script')
  return evalRemotePlugin(code)
}

/**
 * 读取插件来源配置。
 * 通过全局对象注入，避免在主仓库里硬编码任何扩展音源信息。
 *   window.__lxExtSourcePlugins__ = {
 *     remotes: ['https://your-host/qs.plugin.js', ...],
 *     locals: [factory1, factory2, ...],   // 可选
 *   }
 */
const getPluginConfig = () => {
  const cfg = (typeof window !== 'undefined' && window.__lxExtSourcePlugins__) || {}
  return {
    remotes: Array.isArray(cfg.remotes) ? cfg.remotes : [],
    locals: Array.isArray(cfg.locals) ? cfg.locals : [],
  }
}

/**
 * 同步加载本地插件工厂（window.__lxExtSourcePlugins__.locals）。
 *
 * 之所以提供「同步加载」：主程序多个 store 在模块 import 阶段就会遍历 music.sources
 * 建立状态容器，若扩展音源仅在异步 init() 阶段注入，则这些 store 无法纳入扩展音源。
 * 因此本地工厂在 index.js 顶层同步注册，保证 music.sources 从一开始即包含它们。
 *
 * 返回 [{ id, name, source }]，失败的工厂被静默跳过。
 */
export const loadLocalSourcePlugins = () => {
  const env = buildPluginEnv()
  const { locals } = getPluginConfig()
  const results = []
  for (const item of locals) {
    // 兼容 webpack CommonJS interop：require 可能返回函数本身或 { default: fn }
    const factory = typeof item === 'function' ? item : item?.default
    if (typeof factory !== 'function') continue
    try {
      const source = factory(env)
      if (!source || !source.id || !source.name) continue
      results.push({ id: source.id, name: source.name, source })
    } catch (err) {
      console.warn('[ext-source] local plugin init failed:', err)
    }
  }
  return results
}

/**
 * 异步加载远程插件（window.__lxExtSourcePlugins__.remotes）。
 * 用于接口热更/新增音源，接口失效时只需更新远程脚本，无需主程序发版。
 * 加载失败的插件被静默跳过，绝不影响主程序其余音源。
 */
export const loadRemoteSourcePlugins = async() => {
  const env = buildPluginEnv()
  const { remotes } = getPluginConfig()
  const results = []
  await Promise.all(remotes.map(async(url) => {
    try {
      const factory = await fetchRemotePlugin(url)
      const source = factory(env)
      if (!source || !source.id || !source.name) return
      results.push({ id: source.id, name: source.name, source })
    } catch (err) {
      console.warn('[ext-source] remote plugin load failed:', url, err)
    }
  }))
  return results
}
