import { httpGet } from './request'

// TODO add Notice

// 更新检测：本项目发布地址为 Miao-moe/lx-Miao-moe-music-desktop 的 GitHub Releases
const REPO_OWNER = 'Miao-moe'
const REPO_NAME = 'lx-Miao-moe-music-desktop'

const address = [
  [`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`, 'github'],
]

const request = async(url, retryNum = 0) => {
  return new Promise((resolve, reject) => {
    httpGet(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'lx-music-desktop',
        Accept: 'application/vnd.github+json',
      },
    }, (err, resp, body) => {
      if (err || resp.statusCode != 200) {
        ++retryNum >= 3
          ? reject(err || new Error(resp.statusMessage || resp.statusCode))
          : request(url, retryNum).then(resolve).catch(reject)
      } else resolve(body)
    })
  })
}

const getGithubReleaseInfo = async(url) => {
  return request(url).then(info => {
    if (!info || info.tag_name == null) throw new Error('failed')
    // GitHub Release 的 tag 常带 v 前缀，统一去除
    const version = String(info.tag_name).replace(/^v/i, '')
    return {
      version,
      desc: info.body ?? '',
      history: [],
    }
  })
}

export const getVersionInfo = async(index = 0) => {
  const [url, source] = address[index]
  let promise
  switch (source) {
    case 'github':
      promise = getGithubReleaseInfo(url)
      break
  }

  return promise.catch(async(err) => {
    index++
    if (index >= address.length) throw err
    return getVersionInfo(index)
  })
}

// getVersionInfo().then(info => {
//   console.log(info)
// })
