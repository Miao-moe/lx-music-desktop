<p align="center"><a href="https://github.com/lyswhut/lx-music-desktop"><img width="200" src="https://github.com/lyswhut/lx-music-desktop/blob/master/doc/images/icon.png" alt="lx-music logo"></a></p>

<h1 align="center">LX Music 桌面版（个人增强版）</h1>

<p align="center">
  <a href="https://github.com/miao-moe/lx-music-desktop/releases"><img src="https://img.shields.io/github/release/miao-moe/lx-music-desktop" alt="Release version"></a>
  <a href="https://electronjs.org/releases/stable"><img src="https://img.shields.io/github/package-json/dependency-version/miao-moe/lx-music-desktop/dev/electron/master" alt="Electron version"></a>
</p>

<p align="center">在 LX Music 桌面版基础上扩展，新增可解耦的扩展音源插件机制与 Cookie 同步功能</p>

---

## 仓库关系说明

| 类型 | 仓库 | 说明 |
| --- | --- | --- |
| **主仓库（上游）（lx原版）** | [lyswhut/lx-music-desktop](https://github.com/lyswhut/lx-music-desktop) | 本项目的原始上游，由落雪无痕维护，基于 Electron + Vue 3 |
| **参考仓库（移动版改造）（lx-x）** | [WalnutBai/lx-lxnetease-music-mobile-pro](https://github.com/WalnutBai/lx-lxnetease-music-mobile-pro) | WalnutBai 基于移动版的个人改造，参考了其 Cookie 同步、Gitcode 音源、Web 播放器换源等思路 |
| **本项目（Fork）（lx-m）** | [Miao-moe/lx-Miao-moe-music-desktop](https://github.com/Miao-moe/lx-Miao-moe-music-desktop) | 本仓库，在主仓库 master 分支上增量开发 |

> 本项目遵循主仓库 [Apache License 2.0](./LICENSE) 协议，所有新增功能仅供个人学习交流使用。

---

## 新增功能（相对于主仓库）

### 1. 扩展音源插件机制（解耦设计）

主仓库内置的音源仅包含 kw / kg / tx / wy / mg / xm。对于版权控制严格、接口变动频繁的
第三方平台，本项目**不再将其解析逻辑内置进主程序**，而是提供一套**扩展音源插件机制**：

- 主程序保持「干净的播放器」定位，仓库内不含任何平台专有接口 / 签名逻辑
- 扩展音源以**独立插件**形式存在，可单独托管、单独更新
- 插件在运行时由加载器动态注入，接口失效时**只需更新插件，无需主程序发版**
- 加载失败的插件被静默跳过，绝不影响内置音源

插件契约与使用方式详见 [`ext-source-plugins/README.md`](./ext-source-plugins/README.md)，
加载器位于 `src/renderer/utils/musicSdk/plugins/loader.js`。

> 具体扩展音源的接口细节不在本仓库维护，请自行编写/托管插件后通过
> `window.__lxExtSourcePlugins__` 配置启用。

### 2. Cookie 同步设置（全平台支持）

> ⚠️ **重要：本项目中的 Cookie 不会用于「高音质解锁」。**
>
> 高音质（320k / flac / hires / master）请通过「基本设置 → 自定义源」配置音源，
> 详见下方 [高音质解锁 / 音源机制](#高音质解锁--音源机制) 章节。

新增「设置 → Cookie 同步设置」面板，可为 **六个平台** 分别配置 Cookie：

| 平台 | 关键字段 | 用途 |
| --- | --- | --- |
| 网易云音乐 | `MUSIC_U` / `__csrf` | 同步「我喜欢的音乐」、上报播放记录 |
| QQ 音乐 | `uin` / `qqmusic_key` | 同步自建歌单、上报播放记录 |
| 酷狗音乐 | `kg_mid` / `kg_user_v` | 同步「我喜欢」、上报播放记录 |
| 酷我音乐 | `kw_token` | 同步「我喜欢的歌单」、上报播放记录 |
| 咪咕音乐 | `migu_music_sid` | 同步收藏、上报播放记录 |
| **Bilibili** | `SESSDATA` / `bili_jct` | 同步收藏视频、上报播放记录 |

两个独立开关：

- **播放记录同步**：每首歌播放完成后上报到对应平台，影响平台「每日推荐」算法
- **收藏歌单同步**：本地收藏的歌曲定期上报到对应平台「我喜欢」歌单

### 3. Fluent UI 风格图标库（重新设计）

主仓库原本使用 Ionicons（外部图标库，含 `class="prefix__ionicon"` 残留）。
本项目将其全部重新设计为 **Microsoft Fluent UI System Icons** 风格：

- 24x24 viewBox，统一视觉重量
- `fill="currentColor"`，主题色自动跟随
- 圆角几何 + 1px stroke，符合 Fluent UI 设计语言
- 从 18 个扩展到 **44 个**，新增播放控制（play/pause/prev/next/shuffle/repeat）、收藏（heart）、列表、设置、用户等
- 路径：`src/renderer/assets/svgs/`（生成器：`scripts/gen-icons.js`）

### 4. 高级设置面板（UI 增强 + 播放增强）

新增「设置 → 高级」面板，包含两大块功能：

#### 界面增强

- **动态背景**：基于当前播放歌曲的专辑封面，应用毛玻璃高斯模糊效果，作为整个应用的背景
- **背景模糊强度**：0-80px 滑块调节
- **背景亮度**：0-100% 滑块调节（值越小背景越暗，文字对比度越高）
- **平滑动画**：全局 CSS 动画系统，控制页面切换/列表项过渡/弹窗淡入
- **动画速率**：0.5x-1.5x 滑块调节（慢一倍 / 默认 / 快一半）

#### 播放增强

- **无缝衔接（Gapless Playback）**：双 audio 引擎交叉淡化，避免歌曲切换的音频中断
- **渐入渐出（Fade-in / Fade-out）**：切歌时音量在指定毫秒内平滑过渡
- **渐入渐出持续时间**：100-3000ms 滑块调节

### 5. 设置页快捷键

在设置页中支持 **Alt + ←** / **Alt + →** 切换上一个 / 下一个设置面板，
无需鼠标点击侧边导航，提升设置浏览效率。

---

## 高音质解锁 / 音源机制

**核心原则**：高音质解锁通过「自定义音源」实现，与 Cookie 无关。

### 什么是自定义音源

LX Music 内置的 kw / kg / tx / wy / mg 等音源默认只能拿到 128k 音频（接口限制），
更高音质（320k / flac / hires）需要由用户手动导入「自定义源」（即一段 JS 脚本）来代理播放链接请求。

自定义源脚本本质上是一个 HTTP 代理：LX Music 把歌曲信息（songmid / hash）和期望音质告诉脚本，
脚本去对应平台「带 VIP Cookie 请求」拿到高音质音频直链返回给 LX Music。

### 如何启用高音质

1. 打开「设置 → 音源 → 预设音源链接」
2. 点击「复制链接」按钮，复制任一音源链接（推荐 SixYin 或 Huibq）
3. 打开「设置 → 基本设置 → 自定义源 → 自定义源管理」
4. 选择「在线导入」→ 粘贴链接 → 确认
5. 回到「基本设置」选择刚导入的音源作为当前音源
6. 在「设置 → 播放设置 → 优先播放的音质」中选择 320k / flac / hires

### 自定义音源 vs 扩展音源插件

| 项目 | 自定义音源（主仓库机制） | 扩展音源插件（本项目机制） |
| --- | --- | --- |
| 安装方式 | 用户手动导入脚本 | 由加载器动态注入（本地/远程） |
| 定位 | 为内置 5 大平台「换高音质直链」 | 注册主程序未内置的独立音源 |
| 平台覆盖 | kw/kg/tx/wy/mg | 由插件自行定义 |
| 更新方式 | 依赖音源作者维护 | 更新插件即可，主程序无需发版 |
| 主仓库耦合 | 无接口逻辑 | 无接口逻辑（彻底解耦） |

---

## 与参考仓库的差异

参考仓库（lx-x） [WalnutBai/lx-lxnetease-music-mobile-pro](https://github.com/WalnutBai/lx-lxnetease-music-mobile-pro) 是基于 **移动版** 的改造，
本项目是 **桌面版** 的改造，主要差异：

| 特性 | WalnutBai 移动版（参考） | 本项目（桌面版） |
| --- | --- | --- |
| 框架 | React Native | Electron + Vue 3 |
| 平台 | Android | Windows / macOS / Linux |
| Cookie 设置入口 | 设置 → 基本设置 → WyCookie | 设置 → Cookie 同步设置 |
| Cookie 用途 | 同时用于「网易云 vip 歌曲直链」与「同步」 | **仅用于同步**，不解锁音质 |
| 内置音源 | kw/kg/tx/wy/mg + git（Gitcode） | kw/kg/tx/wy/mg/xm + 扩展音源插件机制 |
| 高音质解锁 | 部分依赖 Cookie | 完全依赖自定义音源（与主仓库一致） |

---

## 项目结构（新增/修改部分）

```
src/
├── common/
│   ├── defaultSetting.ts                       # 修改：新增 cookie.* / source.* 默认值
│   └── types/app_setting.d.ts                  # 修改：新增 cookie.* / source.* 类型
└── renderer/
    ├── utils/
    │   ├── cookieManager.ts                    # 新增：Cookie 统一管理工具
    │   └── musicSdk/
    │       ├── index.js                        # 修改：内置音源 + 扩展音源动态注入
    │       ├── plugins/
    │       │   └── loader.js                   # 新增：扩展音源插件加载器（本地/远程）
    │       └── wy/api-cookie.js                # 新增：网易云 Cookie 同步辅助接口（非解锁）
    └── views/Setting/
        ├── index.vue                           # 修改：注册 Cookie / SourceExtra 面板
        └── components/
            ├── SettingCookie.vue               # 新增：Cookie 同步设置面板
            └── SettingSourceExtra.vue          # 新增：音源面板（内置音源 + 预设链接）

ext-source-plugins/                             # 新增：可独立分发的扩展音源插件（不属于主程序内置）
├── README.md                                   # 插件契约与启用说明
├── qs.plugin.js                                # 扩展音源插件示例
└── bili.plugin.js                              # 扩展音源插件示例
```

---

## 开发与构建

本项目与主仓库保持完全兼容的构建方式：

```bash
# 安装依赖
npm install

# 开发模式（启动 Electron + 渲染进程热更新）
npm run dev

# 构建生产包
npm run build
```

详细构建步骤请参考主仓库文档：<https://lyswhut.github.io/lx-music-doc/desktop/use-source-code>

---

## 已知限制

1. **扩展音源插件**：第三方平台接口可能因风控策略变化而失效，插件本身不保证长期可用；接口失效时更新对应插件即可，主程序无需发版。
2. **Cookie 同步**：目前仅实现了网易云平台的同步逻辑（`wy/api-cookie.js`），其他平台的同步逻辑作为 TODO 留待后续完善。

---

## 致谢

- [lyswhut/lx-music-desktop（lx原版）](https://github.com/lyswhut/lx-music-desktop) —— 主仓库，本项目所有基础
- [WalnutBai/lx-lxnetease-music-mobile-pro（lx-x）](https://github.com/WalnutBai/lx-lxnetease-music-mobile-pro) —— 移动版改造，本项目 Cookie 同步思路来源

---

## 项目协议

本项目继承主仓库 [Apache License 2.0](./LICENSE) 协议，并受其补充协议约束。

- 本项目内的官方音乐平台别名为本项目内对官方音乐平台的一个称呼，不包含恶意。
- 本项目不对数据的合法性、准确性负责。
- **禁止在违反当地法律法规的情况下使用本项目。**
- 音乐平台不易，请尊重版权，支持正版。
