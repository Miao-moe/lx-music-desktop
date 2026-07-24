/**
 * 播放记录上报
 *
 * 每首歌播放完毕后，向对应平台上报播放记录，影响平台的「每日推荐」算法。
 * 支持平台：wy / tx / kg。需要对应平台 Cookie 且开启上报开关。
 *
 * 设计要点：
 *   - 上报失败不影响播放，静默丢弃错误
 *   - 对同一首歌 30min 内只上报一次，避免循环切歌刷量
 *   - 仅在自然播放完毕（onEnded）时上报，切歌/手动停止不上报
 */

import { getCookie, getCookieValue, hasCookie, isCookieValid, isPlayHistorySyncEnabled, type MusicSource } from '@renderer/utils/cookieManager'
import { linuxapi } from '@renderer/utils/musicSdk/wy/utils/crypto'
import { toMD5 } from '@renderer/utils/musicSdk/utils'
import { httpFetch } from '@renderer/utils/request'

interface FetchResponse {
  body: any
  statusCode: number
}

const fetchResponse = async(url: string, options: Record<string, any> = {}): Promise<FetchResponse> => {
  return (httpFetch(url, options) as any).promise
}

const reportedCache = new Map<string, number>()
const REPORT_WINDOW_MS = 30 * 60 * 1000

const shouldReport = (id: string) => {
  const last = reportedCache.get(id)
  if (last && Date.now() - last < REPORT_WINDOW_MS) return false
  reportedCache.set(id, Date.now())
  return true
}

// —— 网易云（linuxapi → weapi/feedback/statistic）——
const wyLinuxForward = async(cookie: string, api: string, params: Record<string, any>) => {
  const { body } = await fetchResponse('https://music.163.com/api/linux/forward', {
    method: 'post',
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
      Cookie: cookie,
    },
    form: linuxapi({ method: 'POST', url: `https://music.163.com${api}`, params }),
  })
  if (body?.code === 200) return
  throw new Error(`wy report failed (${body?.code})`)
}

const reportWy = async(cookie: string, songmid: string) => {
  await wyLinuxForward(cookie, '/weapi/feedback/statistic', {
    type: 'song',
    data: [{ id: songmid, sourceId: '0', time: Math.floor(Date.now() / 1000) }],
  })
}

// —— QQ 音乐 ——
const reportTx = async(cookie: string, songmid: string) => {
  await fetchResponse('https://c.y.qq.com/base/fcgi-bin/fcg_music_play', {
    method: 'post',
    headers: { Cookie: cookie, Origin: 'https://y.qq.com', Referer: 'https://y.qq.com/' },
    form: `songmid=${encodeURIComponent(songmid)}&songtype=0&platform=yqq&fromtag=66`,
  })
}

// —— 酷狗（签名网关）——
const KG_APPID = 1005
const KG_CLIENTVER = 20489
const KG_SIGN_SALT = 'OIlwieks28dk2k092lksi2UIkp'

interface KugouAuth { userid: string, token: string, mid: string, dfid: string }

const getKugouAuth = (cookie: string): KugouAuth => {
  const encoded = getCookieValue(cookie, 'KuGoo')
  if (!encoded) throw new Error('kg: missing KuGoo')
  let value = encoded
  try { value = decodeURIComponent(value) } catch {}
  const account = new URLSearchParams(value.replace(/^"|"$/g, ''))
  return {
    userid: account.get('KugooID') ?? account.get('KugouID') ?? '',
    token: account.get('t') ?? '',
    mid: getCookieValue(cookie, 'kg_mid') ?? '-',
    dfid: getCookieValue(cookie, 'kg_dfid') ?? '-',
  }
}

const requestKugou = async(path: string, router: string, data: Record<string, any>, auth: KugouAuth) => {
  const clienttime = Math.floor(Date.now() / 1000)
  const params: Record<string, string | number> = {
    dfid: auth.dfid,
    mid: auth.mid,
    uuid: '-',
    appid: KG_APPID,
    clientver: KG_CLIENTVER,
    clienttime,
    plat: 1,
    userid: auth.userid,
    token: auth.token,
  }
  const bodyText = JSON.stringify(data)
  const signText = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('')
  const signature = toMD5(`${KG_SIGN_SALT}${signText}${bodyText}${KG_SIGN_SALT}`)
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
  query.set('signature', signature)
  return fetchResponse(`https://gateway.kugou.com${path}?${query.toString()}`, {
    method: 'post',
    body: bodyText,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
      'x-router': router,
      dfid: auth.dfid,
      mid: auth.mid,
      clienttime: String(clienttime),
      'kg-rc': '1',
      'kg-thash': '5d816a0',
      'kg-rec': '1',
      'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
    },
  })
}

const reportKg = async(cookie: string, hash: string) => {
  const auth = getKugouAuth(cookie)
  await requestKugou('/v1/report_play', 'playservice.kugou.com', {
    userid: auth.userid,
    token: auth.token,
    hash,
    album_audio_id: 0,
    behaviour: 1,
  }, auth)
}

type PlatformReporter = (cookie: string, songmid: string) => Promise<void>
const reporters: Record<string, PlatformReporter> = {
  wy: reportWy,
  tx: reportTx,
  kg: reportKg,
}

export const reportPlayHistory = async(musicId: string) => {
  if (!isPlayHistorySyncEnabled()) return
  const parts = musicId.split('_')
  const source = parts[0] as MusicSource
  const songmid = parts.slice(1).join('_')
  if (!reporters[source]) return
  if (!hasCookie(source) || !isCookieValid(source)) return
  if (!shouldReport(musicId)) return

  const reporter = reporters[source]
  try {
    await reporter(getCookie(source), songmid)
  } catch {
    // 上报失败不影响播放
  }
}
