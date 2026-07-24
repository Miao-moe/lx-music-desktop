import { createUserList, overwriteListMusics, updateUserList } from '@renderer/store/list/action'
import { userLists } from '@renderer/store/list/listManage/state'
import {
  COOKIE_SOURCES,
  SOURCE_NAME,
  getCookie,
  getCookieValue,
  hasCookie,
  isCookieRecognized,
  isFavListSyncEnabled,
  type CookieSource,
} from '@renderer/utils/cookieManager'
import { deduplicationList, toNewMusicInfo } from '@renderer/utils'
import musicSdk from '@renderer/utils/musicSdk'
import { linuxapi } from '@renderer/utils/musicSdk/wy/utils/crypto'
import { toMD5 } from '@renderer/utils/musicSdk/utils'
import { httpFetch } from '@renderer/utils/request'

interface FetchResponse {
  body: any
  statusCode: number
  headers?: Record<string, any>
}

const fetchResponse = async(url: string, options: Record<string, any> = { method: 'get' }): Promise<FetchResponse> => {
  return (httpFetch(url, options) as any).promise
}

export interface CookieSyncDetail {
  source: CookieSource
  status: 'success' | 'failed'
  listCount: number
  count: number
}

export interface CookieSyncResult {
  synced: boolean
  listCount: number
  count: number
  message?: string
  error?: boolean
  details?: CookieSyncDetail[]
}

export interface RemotePlaylist {
  id: string
  name: string
  raw?: any
}

const SYNC_LIST_ID_PREFIX = 'userlist_'

let syncTask: Promise<CookieSyncResult> | null = null

const buildSyncListId = (source: CookieSource, remoteId: string) => `${SYNC_LIST_ID_PREFIX}${source}_sync_${remoteId}`

const findSyncedList = (source: CookieSource, remoteId: string) => {
  return userLists.find(list => list.id === buildSyncListId(source, remoteId))
}

const wyLinuxForward = async(cookie: string, api: string, params: Record<string, any>) => {
  const { statusCode, body } = await fetchResponse('https://music.163.com/api/linux/forward', {
    method: 'post',
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
      Cookie: cookie,
    },
    form: linuxapi({ method: 'POST', url: `https://music.163.com${api}`, params }),
  })
  if (statusCode !== 200 || body?.code !== 200) throw new Error(`wy api: ${api} failed (${body?.code ?? statusCode})`)
  return body
}

const getWyPlaylists = async(cookie: string): Promise<RemotePlaylist[]> => {
  const account = await wyLinuxForward(cookie, '/api/w/nuser/account/get', {})
  const uid = account?.account?.id ?? account?.profile?.userId
  if (!uid) throw new Error('wy cookie: login expired')
  const body = await wyLinuxForward(cookie, '/api/user/playlist', { uid: String(uid), limit: 1000, offset: 0 })
  if (!Array.isArray(body?.playlist)) throw new Error('wy: failed to load playlists')
  return body.playlist
    .filter((item: any) => String(item?.creator?.userId) === String(uid))
    .map((item: any) => ({ id: String(item.id), name: String(item.name ?? '未命名歌单').trim() }))
    .filter((item: RemotePlaylist) => item.id && item.name)
}

const getWySongs = async(cookie: string, id: string): Promise<LX.Music.MusicInfo[]> => {
  const body = await wyLinuxForward(cookie, '/api/v3/playlist/detail', { id, n: 100000, s: 8 })
  if (!body?.playlist?.tracks) throw new Error('wy: failed to load playlist songs')
  return deduplicationList(musicSdk.wy.songList.filterListDetail(body).map(toNewMusicInfo))
}

const getTxPlaylists = async(cookie: string): Promise<RemotePlaylist[]> => {
  const uin = (getCookieValue(cookie, 'uin') ?? getCookieValue(cookie, 'wxuin') ?? '').match(/\d+/)?.[0]
  if (!uin) throw new Error('tx cookie: missing uin')
  const url = `https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=1&uin=${uin}&hostuin=${uin}&sin=0&size=1000&ein=1000`
  const { body } = await fetchResponse(url, {
    headers: { Cookie: cookie, Origin: 'https://y.qq.com', Referer: 'https://y.qq.com/' },
  })
  const playlists = body?.data?.disslist
  if (body?.code !== 0 || !Array.isArray(playlists)) throw new Error('tx: failed to load playlists')
  return playlists
    .map((item: any) => ({ id: String(item.tid ?? item.dissid ?? ''), name: String(item.diss_name ?? item.title ?? '').trim() }))
    .filter((item: RemotePlaylist) => item.id && item.name)
}

const getTxSongs = async(cookie: string, id: string): Promise<LX.Music.MusicInfo[]> => {
  const { body } = await fetchResponse(musicSdk.tx.songList.getListDetailUrl(id), {
    headers: { Cookie: cookie, Origin: 'https://y.qq.com', Referer: `https://y.qq.com/n/ryqq/playlist/${id}` },
  })
  const songs = body?.cdlist?.[0]?.songlist
  if (body?.code !== 0 || !Array.isArray(songs)) throw new Error('tx: failed to load playlist songs')
  return deduplicationList(musicSdk.tx.songList.filterListDetail(songs).map(toNewMusicInfo))
}

const getKwPlaylists = async(cookie: string): Promise<RemotePlaylist[]> => {
  const uid = (getCookieValue(cookie, 'userid') ?? '').match(/\d+/)?.[0]
  if (!uid) throw new Error('kw cookie: missing userid')
  const { body } = await fetchResponse(`https://nplserver.kuwo.cn/pl.svc?op=getlistbyuid&uid=${encodeURIComponent(uid)}&bigid=1&encode=utf8`)
  if (body?.result !== 'ok' || !Array.isArray(body.plist)) throw new Error('kw: failed to load playlists')
  return body.plist
    .filter((item: any) => String(item.uid) === uid && item.type === 'GENERAL')
    .map((item: any) => ({ id: String(item.id), name: String(item.title ?? '').trim() }))
    .filter((item: RemotePlaylist) => item.id && item.name)
}

const KG_APPID = 1005
const KG_CLIENTVER = 20489
const KG_SIGN_SALT = 'OIlwieks28dk2k092lksi2UIkp'

interface KugouAuth { userid: string, token: string, mid: string, dfid: string }

const getKugouAuth = (cookie: string): KugouAuth => {
  const encoded = getCookieValue(cookie, 'KuGoo')
  if (!encoded) throw new Error('kg cookie: missing KuGoo')
  let value = encoded
  try { value = decodeURIComponent(value) } catch {}
  const account = new URLSearchParams(value.replace(/^"|"$/g, ''))
  const userid = account.get('KugooID') ?? account.get('KugouID') ?? ''
  const token = account.get('t') ?? ''
  if (!userid || !token) throw new Error('kg cookie: incomplete credentials')
  return {
    userid,
    token,
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

  const { body } = await fetchResponse(`https://gateway.kugou.com${path}?${query.toString()}`, {
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
  if (body?.status !== 1 || body?.error_code !== 0) throw new Error(`kg api error: ${body?.error_code ?? 'unknown'}`)
  return body.data
}

const getKgPlaylists = async(cookie: string): Promise<RemotePlaylist[]> => {
  const auth = getKugouAuth(cookie)
  const result: RemotePlaylist[] = []
  const ids = new Set<string>()
  let page = 1
  let total = Number.POSITIVE_INFINITY
  while (result.length < total && page <= 100) {
    const data = await requestKugou('/v7/get_all_list', 'cloudlist.service.kugou.com', {
      userid: auth.userid,
      token: auth.token,
      total_ver: 979,
      type: 2,
      page,
      pagesize: 30,
    }, auth)
    const list = Array.isArray(data?.info) ? data.info : []
    total = Number(data?.list_count ?? list.length)
    let added = 0
    for (const item of list) {
      if (Number(item.type) !== 0 || Number(item.is_def) !== 0) continue
      const id = String(item.listid ?? '')
      if (!id || ids.has(id)) continue
      ids.add(id)
      added++
      result.push({ id, name: String(item.name ?? '').trim() })
    }
    if (!list.length || added === 0) break
    page++
  }
  return result.filter(item => item.id && item.name)
}

const getKgSongs = async(cookie: string, id: string): Promise<LX.Music.MusicInfo[]> => {
  const auth = getKugouAuth(cookie)
  const songs: any[] = []
  let page = 1
  let total = Number.POSITIVE_INFINITY
  while (songs.length < total && page <= 1000) {
    const data = await requestKugou('/v4/get_list_all_file', 'cloudlist.service.kugou.com', {
      listid: id,
      userid: auth.userid,
      token: auth.token,
      area_code: 1,
      show_relate_goods: 0,
      pagesize: 30,
      page,
      allplatform: 1,
      show_cover: 1,
      type: 0,
    }, auth)
    const list = Array.isArray(data?.info) ? data.info : []
    total = Number(data?.count ?? list.length)
    if (!list.length) break
    songs.push(...list.map((song: any) => ({ ...song, hash: song.hash ?? song.FileHash })))
    page++
  }
  const infos = await musicSdk.kg.songList.getMusicInfos(songs)
  return deduplicationList(infos.map(toNewMusicInfo))
}

const parseMiguPlaylists = (body: any): RemotePlaylist[] => {
  const list = body?.data?.myCreatedMusicLists?.createdMusicLists ?? body?.myCreatedMusicLists?.createdMusicLists
  const arr = Array.isArray(list) ? list : []
  return arr
    .map((item: any) => ({ id: String(item.musicListId ?? item.id ?? ''), name: String(item.title ?? item.name ?? '').trim() }))
    .filter((item: RemotePlaylist) => item.id && item.name)
}

const getMgPlaylists = async(cookie: string, captured?: RemotePlaylist[]): Promise<RemotePlaylist[]> => {
  if (captured?.length) return captured
  const { body } = await fetchResponse('https://c.musicapp.migu.cn/pc/user/home-page/v2.0', {
    headers: {
      Cookie: cookie,
      Origin: 'https://music.migu.cn',
      Referer: 'https://music.migu.cn/v5/',
      platform: 'H5',
      ua: 'Android_migu',
      version: '6.8.8',
      IMEI: 'h5page',
      IMSI: 'h5page',
    },
  })
  return parseMiguPlaylists(body)
}

const getPagedSdkSongs = async(source: 'kw' | 'mg', id: string): Promise<LX.Music.MusicInfo[]> => {
  const items: any[] = []
  let page = 1
  let total = Number.POSITIVE_INFINITY
  while (items.length < total && page <= 1000) {
    const result = await musicSdk[source].songList.getListDetail(id, page)
    const list = Array.isArray(result?.list) ? result.list : []
    total = Number(result?.total ?? list.length)
    items.push(...list)
    if (!list.length || items.length >= total) break
    page++
  }
  return deduplicationList(items.map(toNewMusicInfo))
}

const getRemotePlaylists = async(source: CookieSource, cookie: string, captured?: RemotePlaylist[]): Promise<RemotePlaylist[]> => {
  switch (source) {
    case 'wy': return getWyPlaylists(cookie)
    case 'tx': return getTxPlaylists(cookie)
    case 'kg': return getKgPlaylists(cookie)
    case 'kw': return getKwPlaylists(cookie)
    case 'mg': return getMgPlaylists(cookie, captured)
  }
}

const getRemoteSongs = async(source: CookieSource, cookie: string, playlist: RemotePlaylist): Promise<LX.Music.MusicInfo[]> => {
  switch (source) {
    case 'wy': return getWySongs(cookie, playlist.id)
    case 'tx': return getTxSongs(cookie, playlist.id)
    case 'kg': return getKgSongs(cookie, playlist.id)
    case 'kw': return getPagedSdkSongs('kw', playlist.id)
    case 'mg': return getPagedSdkSongs('mg', playlist.id)
  }
}

const syncOnePlaylist = async(source: CookieSource, playlist: RemotePlaylist, songs: LX.Music.MusicInfo[]) => {
  const validSongs = songs.filter(s => s?.id)
  const id = buildSyncListId(source, playlist.id)
  const name = `${SOURCE_NAME[source]} - ${playlist.name}`
  const localList = findSyncedList(source, playlist.id)
  if (localList) {
    if (localList.name !== name || localList.source !== source || localList.sourceListId !== playlist.id) {
      await updateUserList([{ ...localList, name, source, sourceListId: playlist.id }])
    }
    await overwriteListMusics({ listId: id, musicInfos: validSongs })
  } else {
    await createUserList({ id, name, source, sourceListId: playlist.id, list: validSongs })
  }
}

const syncSource = async(source: CookieSource, cookie: string, captured?: RemotePlaylist[]): Promise<{ listCount: number, count: number, failed: number, total: number }> => {
  const playlists = await getRemotePlaylists(source, cookie, captured)
  let listCount = 0
  let count = 0
  let failed = 0
  for (const playlist of playlists) {
    try {
      const songs = await getRemoteSongs(source, cookie, playlist)
      await syncOnePlaylist(source, playlist, songs)
      listCount++
      count += songs.length
    } catch (err) {
      failed++
      console.warn(`[cookieSync] ${source} playlist "${playlist.name}" sync failed:`, err)
    }
  }
  return { listCount, count, failed, total: playlists.length }
}

let syncChain: Promise<unknown> = Promise.resolve()
const serializeSync = async<T>(fn: () => Promise<T>): Promise<T> => {
  const result = syncChain.then(fn, fn)
  syncChain = result.then(() => undefined, () => undefined)
  return result
}

export const syncCookiePlaylists = async(source: CookieSource, captured?: RemotePlaylist[]): Promise<CookieSyncResult> => {
  const cookie = getCookie(source)
  if (!hasCookie(source) || !isCookieRecognized(source, cookie)) {
    return { synced: false, listCount: 0, count: 0, message: 'cookie_unrecognized' }
  }
  return serializeSync(async() => syncSource(source, cookie, captured))
    .then(({ listCount, count, failed, total }) => ({
      synced: listCount > 0 || total === 0,
      listCount,
      count,
      error: failed > 0,
    }))
    .catch((err: any) => {
      console.warn(`[cookieSync] ${source} sync failed:`, err)
      return { synced: false, listCount: 0, count: 0, error: true, message: err?.message ?? 'sync_failed' }
    })
}

const runAllSync = async(): Promise<CookieSyncResult> => {
  const sources = COOKIE_SOURCES.filter(source => hasCookie(source) && isCookieRecognized(source))
  if (!sources.length) return { synced: false, listCount: 0, count: 0, message: 'no_cookie' }

  let listCount = 0
  let count = 0
  let okSources = 0
  let failedSources = 0
  const details: CookieSyncDetail[] = []
  for (const source of sources) {
    let detail: CookieSyncDetail
    try {
      const result = await syncSource(source, getCookie(source))
      listCount += result.listCount
      count += result.count
      okSources++
      if (result.failed > 0) failedSources++
      const success = result.listCount > 0
      detail = { source, status: success ? 'success' : 'failed', listCount: result.listCount, count: result.count }
    } catch (err) {
      failedSources++
      console.warn(`[cookieSync] ${source} sync failed:`, err)
      detail = { source, status: 'failed', listCount: 0, count: 0 }
    }
    details.push(detail)
  }
  return { synced: okSources > 0, listCount, count, error: failedSources > 0, details }
}

// eslint-disable-next-line @typescript-eslint/promise-function-async
export const syncAllPlaylists = (): Promise<CookieSyncResult> => {
  if (syncTask) return Promise.resolve({ synced: false, listCount: 0, count: 0, message: 'syncing' })
  syncTask = serializeSync(runAllSync).finally(() => { syncTask = null })
  return syncTask
}

// eslint-disable-next-line @typescript-eslint/promise-function-async
export const syncWyPlaylists = (): Promise<CookieSyncResult> => syncAllPlaylists()

export const syncCookieListsOnStartup = async(): Promise<void> => {
  if (!isFavListSyncEnabled()) return
  try {
    await syncAllPlaylists()
  } catch (err) {
    console.warn('[cookieSync] startup sync failed:', err)
  }
}
