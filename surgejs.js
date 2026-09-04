// Sub-Store Surge 配置模板节点注入脚本
// 参数：name=Sub-Store 中的订阅名称
// 组合订阅额外传入：type=组合订阅
// 也可不用已保存订阅，改传：url=订阅链接

const { name, type, url, includeUnsupportedProxy } = $arguments

let config = $content ?? $files?.[0]
if (typeof config !== 'string' || !config.trim()) {
  throw new Error('请将 Surge 配置模板作为内容或第一个文件传入')
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

const generated = await produceArtifact(artifactOptions)

function sectionRange(text, section) {
  const header = new RegExp(`^\\s*\\[${section.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\]\\s*$`, 'im')
  const match = header.exec(text)
  if (!match) return null
  const bodyStart = match.index + match[0].length
  const nextHeader = /^\s*\[[^\]\r\n]+\]\s*$/gim
  nextHeader.lastIndex = bodyStart
  const next = nextHeader.exec(text)
  return { start: bodyStart, end: next ? next.index : text.length }
}

// Sub-Store 在快捷脚本中通常返回纯节点列表；完整配置产物才带 [Proxy]。
const generatedProxyRange = sectionRange(generated, 'Proxy')
const generatedProxyText = generatedProxyRange
  ? generated.slice(generatedProxyRange.start, generatedProxyRange.end)
  : generated

const proxyLines = generatedProxyText
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#') && !/^\[.+\]$/.test(line))
  .filter(line => /^[^=]+\s*=\s*(ss|ssr|vmess|trojan|vless|http|https|socks5|socks5-tls|snell|hysteria2|tuic|wireguard|external)\s*,/i.test(line))

const nodeNames = proxyLines.map(line => line.slice(0, line.indexOf('=')).trim())
if (!nodeNames.length) {
  throw new Error('订阅没有生成可用的 Surge 节点，已停止输出以避免配置回落为直连')
}

const templateProxyRange = sectionRange(config, 'Proxy')
const groupRange = sectionRange(config, 'Proxy Group')
if (!templateProxyRange || !groupRange) {
  throw new Error('模板必须同时包含 [Proxy] 和 [Proxy Group] 区段')
}

const nodeGroupPattern = /^(\s*节点｜选择\s*=\s*select\s*,?)(.*)$/m
const groupBody = config.slice(groupRange.start, groupRange.end)
const nodeGroup = nodeGroupPattern.exec(groupBody)
if (!nodeGroup) {
  throw new Error('模板 [Proxy Group] 中缺少“节点｜选择 = select”策略组')
}

const existingParts = nodeGroup[2]
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
const settingStart = existingParts.findIndex(value => /^[a-z-]+\s*=/.test(value))
const settings = settingStart === -1 ? [] : existingParts.slice(settingStart)
const currentMembers = settingStart === -1 ? existingParts : existingParts.slice(0, settingStart)
const members = [...new Set([...nodeNames, ...currentMembers])]
const updatedGroupLine = `${nodeGroup[1]} ${[...members, ...settings].join(', ')}`
const updatedGroupBody = groupBody.replace(nodeGroup[0], updatedGroupLine)

// 由后向前替换，避免前一段长度变化影响后一段索引。
config = config.slice(0, groupRange.start) + updatedGroupBody + config.slice(groupRange.end)
const refreshedProxyRange = sectionRange(config, 'Proxy')
config = config.slice(0, refreshedProxyRange.start)
  + `\n${proxyLines.join('\n')}\n`
  + config.slice(refreshedProxyRange.end)

$content = config
