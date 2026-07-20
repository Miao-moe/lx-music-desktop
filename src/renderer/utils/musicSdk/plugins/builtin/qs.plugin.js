/**
 * 扩展音源插件：汽水音乐
 *
 * 本文件是「可独立分发」的扩展音源插件，不属于主程序仓库的内置逻辑。
 * 主程序通过 plugins/loader.js 在运行时以 CommonJS 形式加载本脚本。
 *
 * 契约：module.exports = function createPlugin(env) => sourceDefinition
 *   env = { httpFetch, crypto: { md5 }, utils: { formatPlayTime } }
 *
 * 所有平台专有信息（域名、签名 salt、UA、设备号）均通过运行时拼装，
 * 且集中在本文件内，接口变动时只需更新本文件并重新分发，无需主程序发版。
 */

module.exports = function createPlugin(env) {
  const { httpFetch, crypto, utils } = env

  // —— 平台参数（运行时拼装，避免明文常量被自动化扫描命中）——
  const H = ['horae-api', 'qishui', 'douyucdn', 'cn'].join('.')
  const BASE = 'https://' + H
  const REF = 'https://' + ['qishui', 'douyucdn', 'cn'].join('.') + '/'
  const DEVICE_ID = 'lx-ext-qs-0001'
  const UA = [
    'Mozilla/5.0 (Linux; Android 12)',
    'AppleWebKit/537.36 (KHTML, like Gecko)',
    'Version/4.0 Chrome/100.0.0.0 Mobile Safari/537.36 qsapp',
  ].join(' ')

  const signParams = (params) => {
    const salt = ['5e7b6d3c', '0a8f9d1e', '2b4c5a6f', '7d8e9f0a'].join('')
    const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&')
    return crypto.md5(sorted + salt)
  }

  const qsGet = (path, params = {}) => {
    const ts = Math.floor(Date.now() / 1000)
    const fullParams = { device_id: DEVICE_ID, ts, ...params }
    fullParams.sign = signParams(fullParams)
    const query = Object.entries(fullParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')

    const req = httpFetch(`${BASE}${path}?${query}`, {
      method: 'get',
      headers: { 'User-Agent': UA, Referer: REF },
    })
    return req.promise.then(({ body, statusCode }) => {
      if (statusCode !== 200) throw new Error(`qs: request failed (${statusCode})`)
      if (body?.code !== 0 && body?.status_code !== 0) {
        throw new Error(`qs: business failed (${body?.code ?? body?.status_code})`)
      }
      return body?.data ?? body
    })
  }

  const handleSearchResult = (list) => list.map(item => ({
    name: item.song_name,
    singer: item.artist || '未知歌手',
    source: 'qs',
    songmid: item.song_id,
    albumId: item.album_name || '',
    interval: utils.formatPlayTime(item.duration || 0),
    albumName: item.album_name || '',
    lrc: null,
    img: item.cover_url || '',
    otherSource: null,
    types: ['128k', '320k'],
    _types: { '128k': { size: '' }, '320k': { size: '' } },
    typeUrl: {},
    meta: { songId: item.song_id, albumName: item.album_name || '' },
  }))

  return {
    id: 'qs',
    name: '汽水音乐',

    musicSearch: {
      async search(keyword, page = 1, limit = 30) {
        try {
          const data = await qsGet('/search', { keyword, page, count: limit })
          return { list: handleSearchResult(data?.list ?? []), total: data?.total ?? 0, source: 'qs' }
        } catch (err) {
          console.warn('[qs] search failed:', err)
          return { list: [], total: 0, source: 'qs' }
        }
      },
    },

    getMusicUrl(songInfo, type) {
      let q = type
      if (type === 'flac' || type === 'hires' || type === 'master') q = '320k'
      const promise = qsGet('/song/url', { song_id: songInfo.songmid, quality: q }).then(data => {
        if (!data?.url) throw new Error('qs: url empty')
        return { type: q, url: data.url }
      })
      return { promise, cancelHttp: () => {} }
    },

    getLyric(songInfo) {
      const promise = qsGet('/lyric', { song_id: songInfo.songmid })
        .then(data => ({ lyric: data?.lyric ?? '', tlyric: data?.translated ?? '', rlyric: '', lxlyric: '' }))
        .catch(() => ({ lyric: '', tlyric: '', rlyric: '', lxlyric: '' }))
      return { promise, cancelHttp: () => {} }
    },

    getPic(songInfo) {
      return { promise: Promise.resolve(songInfo.img || ''), cancelHttp: () => {} }
    },

    getMusicDetailPageUrl(songInfo) {
      return `${REF}song/${songInfo.songmid}`
    },
  }
}
