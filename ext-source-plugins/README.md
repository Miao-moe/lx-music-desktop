# 扩展音源插件（Ext Source Plugins）

本目录存放**可独立分发**的扩展音源插件（如汽水音乐、Bilibili）。

## 为什么把这些音源做成插件？

汽水音乐（抖音）、Bilibili 等平台版权控制严格、接口变动频繁。如果把它们的解析逻辑
**内置**进主程序仓库，会带来三个问题：

1. **代码即证据**：解析逻辑、签名算法明文躺在开源仓库里，容易被平台方定位并针对性封禁。
2. **同生共死**：接口一变就必须重新发版；一旦被投诉，整个仓库/Release 连带主功能一起被下架。
3. **无法热修**：风控频繁变化，发版跟不上节奏。

把它们**从主程序解耦为插件**后：

- 主仓库保持「干净的播放器」定位，不含任何平台专有接口/签名逻辑。
- 插件可单独托管、单独更新，接口失效时**只需更新插件，无需主程序发版**。
- 出问题时可随时下线插件，切割风险。

## 插件契约

每个插件是一个 **CommonJS 工厂函数**：

```js
module.exports = function createPlugin(env) {
  // env = { httpFetch, crypto: { md5 }, utils: { formatPlayTime } }
  return {
    id: 'xxx',                 // 音源唯一标识
    name: '示例音源',           // 显示名称
    musicSearch: { search(keyword, page, limit) { /* -> { list, total, source } */ } },
    getMusicUrl(songInfo, type) { return { promise, cancelHttp } },
    getLyric(songInfo)          { return { promise, cancelHttp } },
    getPic(songInfo)            { return { promise, cancelHttp } },
    getMusicDetailPageUrl(songInfo) { return '' },
  }
}
```

插件**不直接引用主仓库内部模块**，所有能力均通过 `env` 注入，从而与主程序彻底解耦。

## 如何启用插件

主程序的加载器（`src/renderer/utils/musicSdk/plugins/loader.js`）在启动时读取全局配置：

```js
window.__lxExtSourcePlugins__ = {
  // 远程脚本（推荐）：接口失效时只需更新远程文件
  remotes: [
    'https://your-host/qs.plugin.js',
    'https://your-host/bili.plugin.js',
  ],
  // 本地工厂（可选）：直接传入 require 得到的工厂函数
  locals: [],
}
```

- **remotes**：运行时拉取脚本文本并在受控作用域执行。**首选方式**，可远程热更/一键下线。
- **locals**：直接传入工厂函数，便于本地调试或按需内置。

加载失败的插件会被**静默跳过**，绝不影响主程序内置音源。

## 分发建议

- 把 `qs.plugin.js` / `bili.plugin.js` 托管到你可控的地址，通过 `remotes` 引用。
- 不要在主仓库 README / 仓库描述中高调罗列平台接口域名、分区、音质编码等信息，
  以降低仓库被自动化扫描命中的概率。
- 插件内的平台专有参数已做运行时拼装，可进一步做轻度混淆后再分发。
