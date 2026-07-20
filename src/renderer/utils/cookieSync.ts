/**
 * Cookie 同步编排
 *
 * 负责把「基于 Cookie 的平台歌单」同步到本地歌单。
 * 目前实现网易云：同步「我喜欢的音乐」以及所有「自己创建」的歌单。
 *
 * 使用场景：
 *   1. 软件启动时自动同步一次（见 core/useApp/useDataInit）
 *   2. 「设置 → Cookie 同步设置」中的「立即同步」按钮
 *
 * 设计要点：
 *   - 每个网易云歌单对应一个本地歌单，使用「按歌单 id 派生的固定本地 id」，
 *     重复同步为「覆盖」而非「追加」，避免歌曲重复堆积
 *   - 带并发锁，启动同步与手动同步不会互相打断
 *   - 单个歌单同步失败不影响其它歌单
 *   - 未开启同步开关 / 未配置 Cookie 时静默跳过
 */

import { getCreatedPlaylists, getPlaylistSongDetails } from '@renderer/utils/musicSdk/wy/api-cookie'
import { createUserList, overwriteListMusics, updateUserList } from '@renderer/store/list/action'
import { userLists } from '@renderer/store/list/listManage/state'
import { isFavListSyncEnabled, hasCookie } from '@renderer/utils/cookieManager'
import { deduplicationList, toNewMusicInfo } from '@renderer/utils'

/** 同步生成的本地歌单 id 前缀（按网易云歌单 id 派生固定 id） */
const WY_SYNC_LIST_ID_PREFIX = 'userlist_wy_sync_'

export interface CookieSyncResult {
  /** 是否执行了同步（未开启开关/无 Cookie 时为 false） */
  synced: boolean
  /** 成功同步的歌单数量 */
  listCount: number
  /** 同步到的歌曲总数量 */
  count: number
  /** 结果说明（用于 UI 反馈），可能为错误信息 */
  message?: string
  /** 是否发生错误 */
  error?: boolean
}

let syncTask: Promise<CookieSyncResult> | null = null

/** 同步单个网易云歌单到本地 */
const syncOnePlaylist = async(playlist: { id: string, name: string }): Promise<{ success: boolean, count: number }> => {
  try {
    const rawList = await getPlaylistSongDetails(playlist.id)
    // 旧 SDK 歌曲格式 → 本地 LX.Music.MusicInfo，并去重
    const list = deduplicationList(rawList.map(m => toNewMusicInfo(m))) as LX.Music.MusicInfo[]

    const listId = `${WY_SYNC_LIST_ID_PREFIX}${playlist.id}`
    const name = `网易云 - ${playlist.name}`
    const localList = userLists.find(l => l.id === listId)
    if (localList) {
      if (localList.name !== name) await updateUserList([{ ...localList, name }])
      await overwriteListMusics({ listId, musicInfos: list })
    } else {
      await createUserList({ id: listId, name, list })
    }
    return { success: true, count: list.length }
  } catch (err) {
    console.warn('[cookieSync] sync playlist failed:', playlist.name, err)
    return { success: false, count: 0 }
  }
}

/**
 * 同步网易云「我喜欢」及所有自建歌单到本地。
 * @returns 同步结果
 */
const runWyPlaylistsSync = async(): Promise<CookieSyncResult> => {
  try {
    const playlists = await getCreatedPlaylists()
    if (!playlists.length) {
      return { synced: true, listCount: 0, count: 0, message: '未获取到歌单（Cookie 失效或无自建歌单）' }
    }

    let totalSongs = 0
    let syncedLists = 0
    for (const playlist of playlists) {
      const result = await syncOnePlaylist(playlist)
      if (result.success) {
        totalSongs += result.count
        syncedLists++
      }
    }
    return { synced: true, listCount: syncedLists, count: totalSongs }
  } catch (err: any) {
    console.warn('[cookieSync] sync wy playlists failed:', err)
    return { synced: false, listCount: 0, count: 0, error: true, message: err?.message ?? '同步失败' }
  }
}

// 保持非 async 以便在任何 await 发生前同步设置任务锁，避免并发同步。
// eslint-disable-next-line @typescript-eslint/promise-function-async
export const syncWyPlaylists = (): Promise<CookieSyncResult> => {
  if (!isFavListSyncEnabled()) return Promise.resolve({ synced: false, listCount: 0, count: 0, message: '未开启收藏歌单同步' })
  if (!hasCookie('wy')) return Promise.resolve({ synced: false, listCount: 0, count: 0, message: '未配置网易云 Cookie' })
  if (syncTask) return Promise.resolve({ synced: false, listCount: 0, count: 0, message: '正在同步中' })

  syncTask = runWyPlaylistsSync().finally(() => {
    syncTask = null
  })
  return syncTask
}

/**
 * 启动时同步入口：静默执行，失败不影响启动流程。
 */
export const syncCookieListsOnStartup = async(): Promise<void> => {
  try {
    await syncWyPlaylists()
  } catch (err) {
    console.warn('[cookieSync] startup sync failed:', err)
  }
}
