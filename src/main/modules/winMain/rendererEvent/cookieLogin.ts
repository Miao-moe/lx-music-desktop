import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mainHandle } from '@common/mainIpc'
import { chromium, type Response } from 'playwright-core'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

type MusicSource = 'wy' | 'tx' | 'kg' | 'kw' | 'mg'
interface CookieLoginDefinition {
  url: string
  domains: string[]
  cookieGroups: string[][]
  storageKeys?: string[]
  storageGroups?: string[][]
}

interface CookieLoginPlaylist {
  id: string
  name: string
}

interface CookieLoginResult {
  cookie: string
  playlists?: CookieLoginPlaylist[]
}

const COOKIE_LOGIN_DEFINITIONS: Record<MusicSource, CookieLoginDefinition> = {
  wy: {
    url: 'https://music.163.com/',
    domains: ['163.com'],
    cookieGroups: [['MUSIC_U']],
  },
  tx: {
    url: 'https://y.qq.com/',
    domains: ['qq.com'],
    cookieGroups: [['uin', 'qqmusic_key']],
  },
  kg: {
    url: 'https://www.kugou.com/',
    domains: ['kugou.com'],
    cookieGroups: [['KuGoo'], ['kg_mid', 'kg_user_v']],
  },
  kw: {
    url: 'https://www.kuwo.cn/',
    domains: ['kuwo.cn'],
    cookieGroups: [['kw_token'], ['userid']],
  },
  mg: {
    url: 'https://music.migu.cn/v5/',
    domains: ['migu.cn'],
    cookieGroups: [['migu_music_sid'], ['USER_ID']],
    storageKeys: [
      'mg_auth_sid',
      'mg_auth_pacmtoken',
      'mg_auth_uid',
      'mg_auth_utoken',
      'migu-utoken-sessionid',
    ],
    storageGroups: [['mg_auth_sid', 'mg_auth_uid']],
  },
}

// ===== 工具函数 =====
const loginTasks = new Map<MusicSource, Promise<CookieLoginResult>>()

const getRelevantCookies = (
  cookies: Array<{ name: string, value: string }>,
  definition: CookieLoginDefinition,
) => {
  const allowed = new Set<string>()
  for (const group of definition.cookieGroups) {
    for (const name of group) allowed.add(name)
  }
  return cookies
    .filter(cookie => allowed.has(cookie.name))
    .filter(cookie => cookie.value)
}

const hasLoginState = (
  cookies: Array<{ name: string }>,
  storage: Map<string, string>,
  definition: CookieLoginDefinition,
) => {
  const names = new Set([...cookies.map(cookie => cookie.name), ...storage.keys()])
  return [...definition.cookieGroups, ...(definition.storageGroups ?? [])]
    .some(group => group.every(name => names.has(name)))
}

const sanitizeCookieValue = (value: string) => value.replace(/[\r\n]/g, '')

const serializeCookies = (
  cookies: Array<{ name: string, value: string }>,
  storage: Map<string, string>,
) => {
  const values = new Map<string, string>()
  for (const cookie of cookies) values.set(cookie.name, sanitizeCookieValue(cookie.value))
  for (const [name, value] of storage) values.set(name, sanitizeCookieValue(value))
  return Array.from(values, ([name, value]) => `${name}=${value}`).join('; ')
}

const getRelevantStorage = async(
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
  definition: CookieLoginDefinition,
) => {
  const values = new Map<string, string>()
  if (!definition.storageKeys?.length) return values
  const keys = new Set(definition.storageKeys)
  for (const page of context.pages()) {
    const entries = await page.evaluate(() => Object.entries(localStorage)).catch(() => [])
    for (const [name, value] of entries) {
      if (keys.has(name) && value) values.set(name, value as string)
    }
  }
  return values
}

const parseMiguPlaylists = (body: any): CookieLoginPlaylist[] | undefined => {
  const lists = body?.data?.myCreatedMusicLists?.createdMusicLists
    ?? body?.myCreatedMusicLists?.createdMusicLists
  if (!Array.isArray(lists)) return
  return lists
    .map((item: any) => ({
      id: String(item.musicListId ?? item.id ?? ''),
      name: String(item.title ?? item.name ?? '').trim(),
    }))
    .filter((item: CookieLoginPlaylist) => item.id && item.name)
}

// ===== Playwright 登录实现 =====
const loginWithPlaywright = async(source: MusicSource): Promise<CookieLoginResult> => {
  const definition = COOKIE_LOGIN_DEFINITIONS[source]
  if (!definition) throw new Error(`Cookie login not supported for source: ${source}`)

  const userDataDir = path.join(os.tmpdir(), `lx-m-cookie-login-${source}-${Date.now()}`)
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      channel: 'chrome',
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-component-update',
      ],
    })

    let miguPlaylists: CookieLoginPlaylist[] | undefined
    const watchMiguPlaylists = (page: any) => {
      if (source != 'mg') return
      page.on('response', (response: Response) => {
        if (!response.url().includes('/pc/user/home-page/v2.0')) return
        void response.json().then((body: any) => {
          const playlists = parseMiguPlaylists(body)
          if (playlists) miguPlaylists = playlists
        }).catch(() => {})
      })
    }

    for (const currentPage of context.pages()) watchMiguPlaylists(currentPage)
    context.on('page', watchMiguPlaylists)

    const page = context.pages()[0] ?? await context.newPage()
    await page.goto(definition.url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})

    const deadline = Date.now() + 5 * 60 * 1000
    while (Date.now() < deadline) {
      const relevantCookies = getRelevantCookies(await context.cookies(), definition)
      const storage = await getRelevantStorage(context, definition)
      if (hasLoginState(relevantCookies, storage, definition)) {
        if (source == 'mg' && miguPlaylists == null) {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
          const playlistDeadline = Date.now() + 8_000
          // mg 歌单由 response 监听器在 reAfter reload 后异步填充
          // eslint-disable-next-line no-unmodified-loop-condition
          while (miguPlaylists == null && Date.now() < playlistDeadline) await wait(250)
        }

        const finalCookies = getRelevantCookies(await context.cookies(), definition)
        const finalStorage = await getRelevantStorage(context, definition)
        const cookie = serializeCookies(finalCookies, finalStorage)
        if (cookie) return { cookie, playlists: miguPlaylists }
      }
      await wait(1000)
    }

    throw new Error(`Cookie login timed out for source: ${source}`)
  } finally {
    if (context) {
      await context.close().catch(() => {})
      // 等待浏览器完全关闭后清理临时 profile
      await wait(2000)
    }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch {}
  }
}

const login = async(source: MusicSource): Promise<CookieLoginResult> => {
  if (loginTasks.has(source)) return loginTasks.get(source)!
  const task = loginWithPlaywright(source).finally(() => { loginTasks.delete(source) })
  loginTasks.set(source, task)
  return task
}

// ===== 注册 IPC 处理器 =====
export default () => {
  mainHandle<MusicSource, CookieLoginResult>(
    WIN_MAIN_RENDERER_EVENT_NAME.cookie_login,
    async({ params: source }) => login(source),
  )
}
