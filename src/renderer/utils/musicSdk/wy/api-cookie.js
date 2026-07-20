/**
 * 网易云音乐 Cookie 同步接口（基于 NeteaseCloudMusicApiEnhanced）
 *
 * ⚠️ 重要：高音质解锁请使用「设置 → 基本设置 → 自定义源」中的音源，
 *      不要依赖 Cookie。Cookie 在本项目中的唯一用途是：
 *        1. 拉取登录用户的云端歌单到本地
 *        2. 将本地播放记录上报到平台
 *
 * 本模块调用项目指定的 Enhanced REST 服务，由服务端处理网易云接口与加密。
 */
import { httpFetch } from '../../request'
import musicDetail from './musicDetail'
import { getCookie, isPlayHistorySyncEnabled, isFavListSyncEnabled } from '../../cookieManager'

const WY_API_BASE = 'http://171.80.3.149:3036'

const buildApiUrl = (path, params = {}) => {
  const query = new URLSearchParams({
    ...params,
    timestamp: String(Date.now()),
  }).toString()
  return `${WY_API_BASE}${path}?${query}`
}

const apiGet = async(path, params = {}) => {
  const cookie = getCookie('wy')
  if (!cookie) throw new Error('wy cookie: not configured')

  const req = httpFetch(buildApiUrl(path, params), {
    method: 'get',
    headers: {
      Cookie: cookie,
    },
  })
  const { body, statusCode } = await req.promise
  if (statusCode !== 200 || body?.code !== 200) {
    throw new Error(body?.message || `wy api: request failed (${body?.code ?? statusCode})`)
  }
  return body
}

/**
 * 获取登录用户基本信息
 * 用于「设置 → Cookie」面板显示当前登录账号。
 */
export const getUserInfo = async() => {
  const body = await apiGet('/user/account')
  const userId = body?.profile?.userId ?? body?.account?.id
  if (!userId) throw new Error('wy cookie: login expired')
  return {
    ...(body.account ?? {}),
    ...(body.profile ?? {}),
    userId,
  }
}

/**
 * 获取登录用户「自己创建」的所有歌单（含「我喜欢的音乐」）。
 * 仅当「设置 → Cookie → 收藏歌单同步」开关开启时返回数据。
 *
 * 网易云 /user/playlist 会同时返回「创建的」和「收藏的」歌单，
 * 这里通过 creator.userId === 当前用户 id 过滤，只保留自建歌单。
 *
 * @returns [{ id, name }] 歌单列表（第一个通常为「我喜欢的音乐」）
 */
export const getCreatedPlaylists = async() => {
  if (!isFavListSyncEnabled()) return []
  const user = await getUserInfo()
  if (!user.userId) return []

  const body = await apiGet('/user/playlist', {
    uid: String(user.userId),
    limit: '1000',
    offset: '0',
  })
  const playlists = body?.playlist ?? []
  // 只保留自己创建的歌单（过滤掉收藏的他人歌单）
  return playlists
    .filter((p) => String(p.creator?.userId ?? p.userId) === String(user.userId))
    .map((p) => ({ id: String(p.id), name: p.name || '未命名歌单' }))
}

/**
 * 获取指定歌单的完整歌曲信息（用于导入本地歌单）。
 * Enhanced 的 /playlist/track/all 直接返回全部 songs 与 privileges，
 * 无需客户端再使用 weapi 分批请求歌曲详情。
 *
 * @param playlistId 歌单 id
 * @returns LX 歌曲信息数组（wy 源，旧 SDK 格式）
 */
export const getPlaylistSongDetails = async(playlistId) => {
  const body = await apiGet('/playlist/track/all', {
    id: String(playlistId),
    limit: '100000',
    offset: '0',
  })
  const songs = body?.songs ?? []
  if (!songs.length) return []

  const privileges = songs.map((song) => {
    return body?.privileges?.find(p => p.id === song.id) ?? {
      id: song.id,
      maxbr: 128000,
      maxBrLevel: 'standard',
    }
  })
  return musicDetail.filterList({ songs, privileges })
}

/**
 * 上报一条播放记录到网易云（用于「每日推荐」算法）
 * 仅当「设置 → Cookie → 播放记录同步」开关开启时调用。
 *
 * @param songId 歌曲 songmid
 * @param time 已播放秒数
 */
export const reportPlayHistory = async(songId, time, sourceId = 0) => {
  if (!isPlayHistorySyncEnabled()) return

  try {
    await apiGet('/scrobble', {
      id: String(songId),
      sourceid: String(sourceId),
      time: String(Math.floor(time)),
    })
  } catch (err) {
    console.warn('[wy cookie] report play history failed:', err)
  }
}
