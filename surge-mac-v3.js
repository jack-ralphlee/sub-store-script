// Sub-Store Surge Mac 配置模板节点注入脚本（兼容 VLESS 等 Surge 原生不支持的节点）
// 参数：name=Sub-Store 中的订阅名称；组合订阅额外传入 type=组合订阅；也可传 url=订阅链接。
// 要求：仅限 Surge for Mac。遇到非原生协议时会调用本机 mihomo 外部代理程序。

const { name, type, url } = $arguments
let config = $content ?? $files[0]

if (typeof config !== 'string' || !config.trim()) {
  throw new Error('请将 Surge 配置模板作为内容或第一个文件传入')
}
if (!url && !name) {
  throw new Error('请在脚本参数中填写 Sub-Store 订阅名称：name')
}

const sourceType = /^1$|col|组合/i.test(type ?? '') ? 'collection' : 'subscription'
const options = {
  name,
  type: sourceType,
  platform: 'SurgeMac',
  produceOpts: {
    // 让 Surge Mac 调用 mihomo，兼容 VLESS、Reality 等 Surge 原生不支持的节点。
    useMihomoExternal: true,
    'include-unsupported-proxy': true,
  },
}
if (url) {
  options.subscription = { name: name || '临时订阅', url, source: 'remote' }
}

const generated = await produceArtifact(options)

function findSection(text, name) {
  const pattern = new RegExp(`^\\s*\\[${name}\\]\\s*$`, 'im')
  const startMatch = pattern.exec(text)
  if (!startMatch) return null
  const start = startMatch.index + startMatch[0].length
  const followingHeader = /^\s*\[[^\]\r\n]+\]\s*$/gim
  followingHeader.lastIndex = start
  const endMatch = followingHeader.exec(text)
  return { start, end: endMatch ? endMatch.index : text.length }
}

// Surge/SurgeMac 目标的正常产物是纯节点列表；若返回完整配置，则只取其 [Proxy] 区。
const sourceProxy = findSection(generated, 'Proxy')
const generatedProxyText = sourceProxy
  ? generated.slice(sourceProxy.start, sourceProxy.end)
  : generated
const proxyLines = generatedProxyText
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#') && !/^\[.+\]$/.test(line))
  .filter(line => /^[^=\r\n]+\s*=\s*[^,\r\n]+\s*,/.test(line))

if (!proxyLines.length) {
  throw new Error('订阅没有可写入的节点；请确认“cf”订阅本身含有有效节点')
}

const proxySection = findSection(config, 'Proxy')
const groupSection = findSection(config, 'Proxy Group')
if (!proxySection || !groupSection) {
  throw new Error('模板必须包含 [Proxy] 和 [Proxy Group] 区段')
}

const groupText = config.slice(groupSection.start, groupSection.end)
const groupPattern = /^(\s*节点｜选择\s*=\s*select\s*,?)(.*)$/m
const groupMatch = groupPattern.exec(groupText)
if (!groupMatch) {
  throw new Error('模板 [Proxy Group] 中缺少“节点｜选择 = select”策略组')
}

const nodeNames = proxyLines.map(line => line.slice(0, line.indexOf('=')).trim())
const originalItems = groupMatch[2].split(',').map(item => item.trim()).filter(Boolean)
const firstSetting = originalItems.findIndex(item => /^[a-z-]+\s*=/.test(item))
const originalNodes = firstSetting === -1 ? originalItems : originalItems.slice(0, firstSetting)
const settings = firstSetting === -1 ? [] : originalItems.slice(firstSetting)
const allNodes = [...new Set([...nodeNames, ...originalNodes])]
const newGroupLine = `${groupMatch[1]} ${[...allNodes, ...settings].join(', ')}`
const updatedGroups = groupText.replace(groupMatch[0], newGroupLine)

config = config.slice(0, groupSection.start) + updatedGroups + config.slice(groupSection.end)
const refreshedProxySection = findSection(config, 'Proxy')
config = config.slice(0, refreshedProxySection.start)
  + `\n${proxyLines.join('\n')}\n`
  + config.slice(refreshedProxySection.end)

$content = config
