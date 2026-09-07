// Sub-Store Surge 配置模板节点注入脚本
// 参照 sing-box 注入脚本的功能，为指定的 Surge 配置模板（文件2）注入节点
// 参数：name=Sub-Store 中的订阅名称
// 组合订阅额外传入：type=组合订阅
// 也可不用已保存订阅，改传：url=订阅链接

const { name, type, url, includeUnsupportedProxy } = $arguments

let config = $content ?? $files[0]
if (typeof config !== 'string' || !config.trim()) {
  throw new Error('模板不是合法的字符串配置，无法解析为 Surge 配置')
}

const sourceType = /^1$|col|组合/i.test(type ?? '')
  ? 'collection'
  : 'subscription'

if (!url && !name) {
  throw new Error('请在脚本参数中填写 Sub-Store 订阅名称：name')
}

const artifactOptions = {
  name,
  type: sourceType,
  platform: 'Surge',
  produceOpts: {
    'include-unsupported-proxy': includeUnsupportedProxy,
  },
}

// 【新增/修正逻辑】获取图3中填写的远程订阅链接
let targetUrl = url
if (url) {
  artifactOptions.subscription = {
    name: name || '临时订阅',
    url,
    source: 'remote',
  }
} else if (name) {
  // 尝试从 Sub-Store 标准内部缓存结构中拉取对应订阅的原始链接
  try {
    const subs = $substore.cache?.subscriptions
    if (Array.isArray(subs)) {
      const sub = subs.find(s => s.name === name)
      if (sub && sub.url) targetUrl = sub.url
    } else if (subs && typeof subs === 'object' && subs[name]) {
      targetUrl = subs[name].url
    }
  } catch (e) {
    console.log('自动获取订阅链接失败', e)
  }
}

// 如果图3中填写了多行内容，Surge 的 policy-path 只能接受单条链接，这里取第一条有效 http 链接
if (targetUrl) {
  targetUrl = targetUrl.split(/\r?\n/).find(line => line.trim().startsWith('http')) || targetUrl.trim()
}

// 获取生成的 Surge 节点
const generated = await produceArtifact(artifactOptions)

// 辅助函数：定位 Surge 配置的区段
function findSection(text, sectionName) {
  const pattern = new RegExp(`^\\s*\\[${sectionName}\\]\\s*$`, 'im')
  const startMatch = pattern.exec(text)
  if (!startMatch) return null
  const start = startMatch.index + startMatch[0].length
  const followingHeader = /^\s*\[[^\]\r\n]+\]\s*$/gim
  followingHeader.lastIndex = start
  const endMatch = followingHeader.exec(text)
  return { start, end: endMatch ? endMatch.index : text.length }
}

const sourceProxy = findSection(generated, 'Proxy')
const generatedProxyText = sourceProxy ? generated.slice(sourceProxy.start, sourceProxy.end) : generated

// 解析并提取有效节点行
const proxyLines = generatedProxyText
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#') && !/^\[.+\]$/.test(line))
  .filter(line => /^[^=\r\n]+\s*=\s*[^,\r\n]+\s*,/.test(line))

if (proxyLines.length === 0) {
  throw new Error('订阅没有生成可用的 Surge 节点')
}

// 提取节点名称
const nodeNames = proxyLines.map(line => line.slice(0, line.indexOf('=')).trim())

// 定位模板区段
const proxySection = findSection(config, 'Proxy')
const groupSection = findSection(config, 'Proxy Group')

if (!proxySection || !groupSection) {
  throw new Error('模板必须同时包含 [Proxy] 和 [Proxy Group] 区段')
}

// 获取策略组内容并进行防重名检查
let groupText = config.slice(groupSection.start, groupSection.end)
const groupNames = []
const groupLines = groupText.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'))

for (const line of groupLines) {
  const match = line.match(/^\s*([^=]+)\s*=/)
  if (match) {
    groupNames.push(match[1].trim())
  }
}

const reservedTags = new Set(groupNames)
const collisions = nodeNames.filter(name => reservedTags.has(name))
if (collisions.length > 0) {
  throw new Error(`节点名称与模板策略组重名：${[...new Set(collisions)].join('、')}`)
}

// 寻找并替换目标策略组
const groupPattern = /^(\s*✈️ 我的节点\s*=\s*select\s*,?)(.*)$/m
const groupMatch = groupPattern.exec(groupText)

if (!groupMatch) {
  throw new Error('模板 [Proxy Group] 中缺少“✈️ 我的节点 = select”策略组')
}

// 分离原有节点与配置项
const originalItems = groupMatch[2].split(',').map(item => item.trim()).filter(Boolean)
const firstSetting = originalItems.findIndex(item => /^[a-z-]+\s*=/.test(item))
const originalNodes = firstSetting === -1 ? originalItems : originalItems.slice(0, firstSetting)
const settings = firstSetting === -1 ? [] : originalItems.slice(firstSetting)

// 动态替换 policy-path 链接，保留其余配置
const allowedSettings = settings.map(s => {
  if (s.startsWith('policy-path')) {
    return `policy-path=${targetUrl || '获取链接失败_请检查SubStore订阅'}`
  }
  return s
})

// 组装新策略组并写入
const allNodes = [...new Set([...nodeNames, ...originalNodes])]
const newGroupLine = `${groupMatch[1]} ${[...allNodes, ...allowedSettings].join(', ')}`
const updatedGroups = groupText.replace(groupMatch[0], newGroupLine)

config = config.slice(0, groupSection.start) + updatedGroups + config.slice(groupSection.end)

// 将生成的节点写入 [Proxy] 区段
const refreshedProxySection = findSection(config, 'Proxy')
config = config.slice(0, refreshedProxySection.start)
  + `\n${proxyLines.join('\n')}\n\n`
  + config.slice(refreshedProxySection.end)

$content = config
