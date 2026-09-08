// Sub-Store Surge 智能分流注入脚本
// 机场订阅 -> 外部托管 (policy-path)；本地自建节点 -> 仅注入 [Proxy]
// 参数：
// name = 机场订阅/组合订阅名称
// type = 组合订阅 (如果是组合订阅则传，否则不传)
// url = 临时机场订阅链接 (可选)
// localName = Sub-Store 中保存的自建节点订阅名称 (必填，用于注入 Proxy)

const { name, type, url, localName, includeUnsupportedProxy } = $arguments

let config = $content ?? $files[0]
if (typeof config !== 'string' || !config.trim()) {
  throw new Error('模板不是合法的字符串配置，无法解析为 Surge 配置')
}

const sourceType = /^1$|col|组合/i.test(type ?? '')
  ? 'collection'
  : 'subscription'

if (!url && !name) {
  throw new Error('请在脚本参数中填写机场订阅/组合订阅名称：name')
}

if (!localName) {
  throw new Error('请在脚本参数中填写自建节点订阅名称：localName')
}

// ==================== 1. 后台解析机场订阅（用于防重名校验） ====================
const remoteOptions = {
  name,
  type: sourceType,
  platform: 'Surge',
  produceOpts: { 'include-unsupported-proxy': includeUnsupportedProxy },
}
if (url) {
  remoteOptions.subscription = { name: name || '临时订阅', url, source: 'remote' }
}

const remoteGenerated = await produceArtifact(remoteOptions)

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

// 提取机场节点行与名字（仅用于校验）
const remoteProxySection = findSection(remoteGenerated, 'Proxy')
const remoteProxyText = remoteProxySection ? remoteGenerated.slice(remoteProxySection.start, remoteProxySection.end) : remoteGenerated
const remoteProxyLines = remoteProxyText.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && !/^\[.+\]$/.test(l) && /^[^=\r\n]+\s*=\s*[^,\r\n]+\s*,/.test(l))
const remoteNodeNames = remoteProxyLines.map(line => line.slice(0, line.indexOf('=')).trim())

// ==================== 2. 获取并解析本地自建节点（用于实体注入） ====================
const localOptions = {
  name: localName,
  type: 'subscription',
  platform: 'Surge',
  produceOpts: { 'include-unsupported-proxy': includeUnsupportedProxy },
}
const localGenerated = await produceArtifact(localOptions)
const localProxySection = findSection(localGenerated, 'Proxy')
const localProxyText = localProxySection ? localGenerated.slice(localProxySection.start, localProxySection.end) : localGenerated
const localProxyLines = localProxyText.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && !/^\[.+\]$/.test(l) && /^[^=\r\n]+\s*=\s*[^,\r\n]+\s*,/.test(l))
const localNodeNames = localProxyLines.map(line => line.slice(0, line.indexOf('=')).trim())

// ==================== 3. 安全与重名校验 ====================
const proxySection = findSection(config, 'Proxy')
const groupSection = findSection(config, 'Proxy Group')
if (!proxySection || !groupSection) {
  throw new Error('模板必须同时包含 [Proxy] 和 [Proxy Group] 区段')
}

let groupText = config.slice(groupSection.start, groupSection.end)
const groupNames = []
const groupLines = groupText.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'))
for (const line of groupLines) {
  const match = line.match(/^\s*([^=]+)\s*=/)
  if (match) groupNames.push(match[1].trim())
}
const reservedTags = new Set(groupNames)

// 校验机场和自建节点是否与模板策略组重名
const allIncomingNodes = [...remoteNodeNames, ...localNodeNames]
const collisions = allIncomingNodes.filter(name => reservedTags.has(name))
if (collisions.length > 0) {
  throw new Error(`节点名称与模板策略组重名：${[...new Set(collisions)].join('、')}`)
}

// ==================== 4. 核心逻辑：重构 [Proxy Group]（修正类型关键字缺失问题） ====================
// 正则微调：只匹配到等号，保留后面的 select 作为内容处理
const groupPattern = /^(\s*✈️ 我的节点\s*=\s*)(.*)$/m
const groupMatch = groupPattern.exec(groupText)
if (!groupMatch) {
  throw new Error('模板 [Proxy Group] 中缺少“✈️ 我的节点”策略组')
}

// 分离原策略组中的控制参数
const originalItems = groupMatch[2].split(',').map(item => item.trim()).filter(Boolean)
// 过滤掉旧的节点名以及 select，只留下 icon-url 等 key=value 形式的参数
const settings = originalItems.filter(item => /^[a-z-]+\s*=/.test(item))
const allowedSettings = settings.filter(s => 
  !s.startsWith('policy-path') && !s.startsWith('update-interval') && !s.startsWith('no-alert') && !s.startsWith('include-all-proxies')
)

// 计算机场订阅的外部托管 policy-path 地址
const targetPath = url || (sourceType === 'collection'
  ? `/download/collection/${encodeURIComponent(name)}?target=Surge`
  : `/download/${encodeURIComponent(name)}?target=Surge`
)

// 组装参数：外部托管地址 + 24小时更新 + 继承的UI参数
allowedSettings.unshift(`policy-path=${targetPath}`, `update-interval=86400`)

// 【修复点】显式加上 select 关键字，确保符合 Surge 的策略组语法
const newGroupLine = `${groupMatch[1]}select, ${allowedSettings.join(', ')}`
const updatedGroups = groupText.replace(groupMatch[0], newGroupLine)
config = config.slice(0, groupSection.start) + updatedGroups + config.slice(groupSection.end)

// ==================== 5. 核心逻辑：仅将自建节点注入到 [Proxy] 区块 ====================
if (localProxyLines.length > 0) {
  const refreshedProxySection = findSection(config, 'Proxy')
  config = config.slice(0, refreshedProxySection.start)
    + `\n${localProxyLines.join('\n')}\n\n`
    + config.slice(refreshedProxySection.end)
}

$content = config
