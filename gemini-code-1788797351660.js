// Sub-Store Surge 配置模板节点动态注入脚本
// 自动注入最新节点至 [Proxy] 及 “✈️ 我的节点” 策略组，完全由 Sub-Store 动态更新

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

// 获取 Sub-Store 生成的最新 Surge 节点
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

// 提取最新节点名称列表
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

// 寻找并替换目标策略组（基于特征：“✈️ 我的节点 = select”）
const groupPattern = /^(\s*✈️ 我的节点\s*=\s*select\s*,?)(.*)$/m
const groupMatch = groupPattern.exec(groupText)

if (!groupMatch) {
  throw new Error('模板 [Proxy Group] 中缺少“✈️ 我的节点 = select”策略组')
}

// 分离原有配置参数
const originalItems = groupMatch[2].split(',').map(item => item.trim()).filter(Boolean)

// 剔除 policy-path 参数以及旧的静态节点，保留图标与常规配置（如 icon-url, no-alert 等）
const settings = originalItems.filter(item => {
  if (item.startsWith('policy-path')) return false
  return /^[a-z-]+\s*=/i.test(item)
})

// 重新组装“✈️ 我的节点”策略组：注入最新 nodeNames 列表与保留的参数
const finalItems = [...nodeNames, ...settings]
const newGroupLine = `${groupMatch[1]} ${finalItems.join(', ')}`
const updatedGroups = groupText.replace(groupMatch[0], newGroupLine)

config = config.slice(0, groupSection.start) + updatedGroups + config.slice(groupSection.end)

// 将生成的完整节点明细写入 [Proxy] 区段
const refreshedProxySection = findSection(config, 'Proxy')
config = config.slice(0, refreshedProxySection.start)
  + `\n${proxyLines.join('\n')}\n\n`
  + config.slice(refreshedProxySection.end)

$content = config