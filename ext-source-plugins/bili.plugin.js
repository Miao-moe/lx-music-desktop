/**
 * 扩展音源插件：Bilibili
 *
 * 本文件是「可独立分发」的扩展音源插件，不属于主程序仓库的内置逻辑。
 * 主程序通过 plugins/loader.js 在运行时以 CommonJS 形式加载本脚本。
 *
 * 契约：module.exports = function createPlugin(env) => sourceDefinition
 *   env = { httpFetch, crypto: { md5 }, utils: { formatPlayTime } }
 *
 * B 站接口变动/风控策略调整时，只需更新本文件并重新分发，无需主程序发版。
 */

module.exports = function createPlugin(env) {
  const { httpFetch, utils } = env

  // —— 平台参数（运行时拼装）——
  const API = 'https://' + ['api', 'bilibili', 'com'].join('.')
  const REF = 'https://' + ['www', 'bilibili', 'com'].join('.') + '/'
  const UA = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'AppleWebKit/537.36 (KHTML, like Gecko)',
    'Chrome/108.0.0.0 Safari/537.36',
  ].join(' ')
  // 音乐相关分区（运行时拼装，过滤无关内容）
  const MUSIC_TID = [3, 28, 31, 59, 130, 193, 294].join(',')

  const biliGet = (url, params = {}) => {
    const query = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    const fullUrl = query ? `${url}?${query}` : url
    const req = httpFetch(fullUrl, {
      method: 'get',
      headers: { 'User-Agent': UA, Referer: REF },
    })
    return req.promise.then(({ body, statusCode }) => {
      if (statusCode !== 200) throw new Error(`bili: request failed (${statusCode})`)
      if (body?.code !== 0) throw new Error(`bili: business failed (${body?.code}: ${body?.message})`)
      return body?.data ?? body
    })
  }

  const stripHtml = (s) => (s || '').replace(/<[^>]+>/g, '')
  const parseDuration = (s) => {
    if (!s) return 0
    const parts = String(s).split(':').map(n => parseInt(n, 10) || 0)
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return 0
  }

  const handleSearchResult = (items) => items.map(item => ({
    name: stripHtml(item.title),
    singer: item.author || 'UP主',
    source: 'bili',
    songmid: item.bvid,
    albumId: '',
    interval: utils.formatPlayTime(parseDuration(item.duration)),
    albumName: 'Bilibili',
    lrc: null,
    img: item.pic?.startsWith('//') ? `https:${item.pic}` : item.pic || '',
    otherSource: null,
    types: ['128k', '320k'],
    _types: { '128k': { size: '' }, '320k': { size: '' } },
    typeUrl: {},
    meta: { songId: item.bvid, aid: item.aid, albumName: 'Bilibili' },
  }))

  const pickAudioUrl = (audioList, type) => {
    if (!audioList?.length) return null
    const sorted = [...audioList].sort((a, b) => b.bandwidth - a.bandwidth)
    let targetIds
    switch (type) {
      case '128k': targetIds = [30216, 30232]; break
      case '320k':
      case 'flac':
      case 'hires':
      case 'master': targetIds = [30250, 30280, 30232, 30216]; break
      default: targetIds = [30232, 30216]
    }
    for (const id of targetIds) {
      const found = sorted.find(a => a.id === id)
      if (found?.base_url) return found.base_url
      if (found?.backup_url?.[0]) return found.backup_url[0]
    }
    return sorted[0]?.base_url || sorted[0]?.backup_url?.[0] || null
  }

  const subtitleJsonToLrc = (json) => {
    if (!json?.body?.length) return ''
    return json.body.map(line => {
      const from = line.from || 0
      const m = Math.floor(from / 60).toString().padStart(2, '0')
      const s = (from % 60).toFixed(2).padStart(5, '0')
      return `[${m}:${s}]${line.content || ''}`
    }).join('\n')
  }

  return {
    id: 'bili',
    name: 'Bilibili',

    musicSearch: {
      async search(keyword, page = 1, limit = 30) {
        try {
          const data = await biliGet(`${API}/x/web-interface/search/type`, {
            search_type: 'video',
            keyword,
            page,
            page_size: limit,
            order: 'totalrank',
            tid: MUSIC_TID,
          })
          return { list: handleSearchResult(data?.result ?? []), total: data?.numResults ?? 0, source: 'bili' }
        } catch (err) {
          console.warn('[bili] search failed:', err)
          return { list: [], total: 0, source: 'bili' }
        }
      },
    },

    getMusicUrl(songInfo, type) {
      const bvid = songInfo.songmid
      const promise = (async() => {
        const view = await biliGet(`${API}/x/web-interface/view`, { bvid })
        const cid = view?.cid ?? view?.pages?.[0]?.cid
        const aid = view?.aid
        if (!cid || !aid) throw new Error('bili: cid/aid missing')
        const playerData = await biliGet(`${API}/x/player/wbi/v2`, {
          bvid, cid, fnval: 16, fnver: 0, qn: 64,
        })
        const url = pickAudioUrl(playerData?.dash?.audio || [], type)
        if (!url) throw new Error('bili: url empty')
        return { type: ['128k', '320k'].includes(type) ? type : '320k', url }
      })()
      return { promise, cancelHttp: () => {} }
    },

    getLyric(songInfo) {
      const promise = (async() => {
        const bvid = songInfo.songmid
        let cid = songInfo.meta?.cid
        if (!cid) {
          const view = await biliGet(`${API}/x/web-interface/view`, { bvid })
          cid = view?.cid
        }
        if (!cid) return { lyric: '', tlyric: '', rlyric: '', lxlyric: '' }
        const player = await biliGet(`${API}/x/player/wbi/v2`, { bvid, cid })
        const subtitles = player?.subtitle?.subtitles || []
        if (!subtitles.length) return { lyric: '', tlyric: '', rlyric: '', lxlyric: '' }
        const zh = subtitles.find(s => s.lan?.startsWith('zh')) || subtitles[0]
        let url = zh.subtitle_url || ''
        if (url.startsWith('//')) url = `https:${url}`
        const sub = await biliGet(url)
        return { lyric: subtitleJsonToLrc(sub), tlyric: '', rlyric: '', lxlyric: '' }
      })().catch(() => ({ lyric: '', tlyric: '', rlyric: '', lxlyric: '' }))
      return { promise, cancelHttp: () => {} }
    },

    getPic(songInfo) {
      return { promise: Promise.resolve(songInfo.img || ''), cancelHttp: () => {} }
    },

    getMusicDetailPageUrl(songInfo) {
      return `${REF}video/${songInfo.songmid}`
    },
  }
}
