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

if (url) {
  artifactOptions.subscription = {
    name: name || '临时订阅',
    url,
    source: 'remote',
  }
}

// 获取生成的 Surge 节点
const generated = await produceArtifact(artifactOptions)

// 辅助函数：定位 Surge 配置的区段（如 [Proxy]、[Proxy Group]）
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

// 获取策略组内容并进行防重名检查（参考文件1功能）
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

// 寻找并替换目标策略组（基于特征：“✈️ 我的节点 = smart”）
const groupPattern = /^(\s*✈️ 我的节点\s*=\s*smart\s*,?)(.*)$/m
const groupMatch = groupPattern.exec(groupText)

if (!groupMatch) {
  throw new Error('模板 [Proxy Group] 中缺少“✈️ 我的节点 = smart”策略组')
}

/// 分离原有节点与配置项（提取 policy-path 等策略组参数）
const originalItems = groupMatch[2].split(',').map(item => item.trim()).filter(Boolean)
const firstSetting = originalItems.findIndex(item => /^[a-z-]+\s*=/.test(item))
const settings = firstSetting === -1 ? [] : originalItems.slice(firstSetting)

// 1. 策略组：仅写入机场订阅节点 nodeNames，绕过 originalNodes
const newGroupLine = `${groupMatch[1]} ${[...new Set(nodeNames), ...settings].join(', ')}`
const updatedGroups = groupText.replace(groupMatch[0], newGroupLine)
config = config.slice(0, groupSection.start) + updatedGroups + config.slice(groupSection.end)

// 2. [Proxy] 区段：获取模板原有自建节点内容并保留，追加新的机场订阅节点
const refreshedProxySection = findSection(config, 'Proxy')
const originalProxyText = config.slice(refreshedProxySection.start, refreshedProxySection.end).trim()

const finalProxyText = originalProxyText 
  ? `${originalProxyText}\n${proxyLines.join('\n')}`
  : proxyLines.join('\n')

config = config.slice(0, refreshedProxySection.start) + `\n${finalProxyText}\n\n` + config.slice(refreshedProxySection.end)

$content = config