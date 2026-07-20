// import defaultSetting from '@common/defaultSetting'
import createWorkers from '@renderer/worker'

window.lx = {
  // appSetting: defaultSetting,
  isEditingHotKey: false,
  isPlayedStop: false,
  appHotKeyConfig: {
    local: {
      enable: false,
      keys: {},
    },
    global: {
      enable: false,
      keys: {},
    },
  },
  songListInfo: {
    fromName: '',
    searchKey: '',
    searchPosition: 0,
    songlistKey: '',
    songlistPosition: 0,
  },
  restorePlayInfo: null,
  worker: createWorkers(),
  isProd: process.env.NODE_ENV == 'production',
  rootOffset: window.dt ? 0 : 8,
  apiInitPromise: [Promise.resolve(false), true, () => {}],
}

window.lxData = {}

/**
 * 扩展音源插件（解耦设计，默认内置启用）
 * -------------------------------------------------------------
 * 插件源码位于 `src/renderer/utils/musicSdk/plugins/builtin/`，以工厂函数形式导出，
 * musicSdk 初始化时会读取本配置并注入，使其像内置音源一样可搜索/播放。
 *
 * - locals ：本地插件工厂函数（随主程序打包，开箱即用，默认启用）
 * - remotes：远程脚本 URL（可选）。接口失效时只需更新远程文件，无需主程序发版。
 *
 * 默认启用：汽水音乐（qs）、Bilibili（bili）。
 * 如需临时停用某个音源，注释掉对应 require 即可。
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const qsPlugin = require('@renderer/utils/musicSdk/plugins/builtin/qs.plugin.js')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const biliPlugin = require('@renderer/utils/musicSdk/plugins/builtin/bili.plugin.js')

window.__lxExtSourcePlugins__ = window.__lxExtSourcePlugins__ ?? { remotes: [], locals: [] }
window.__lxExtSourcePlugins__.locals = [
  ...(window.__lxExtSourcePlugins__.locals ?? []),
  qsPlugin,
  biliPlugin,
]

window.ELECTRON_DISABLE_SECURITY_WARNINGS = process.env.ELECTRON_DISABLE_SECURITY_WARNINGS
