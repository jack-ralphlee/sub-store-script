// Sub-Store Surge 配置模板节点注入脚本
// 支持 Sub-Store 已保存订阅名称 (name=xxx) 或 远程订阅链接 (url=http...)

const { name, type, url, includeUnsupportedProxy } = $arguments

let config = $content ?? $files?.[0]
if (typeof config !== 'string' || !config.trim()) {
  throw new Error('请将 Surge 配置模板作为内容或第一个文件传入')
}

// 自动兼容上下文订阅参数
const subName = name || (typeof $subscription !== 'undefined' ? $subscription.name : '')
const subUrl = url || (typeof $subscription !== 'undefined' ? $subscription.url : '')

if (!subUrl && !subName) {
  throw new Error('请在脚本参数中填写 Sub-Store 订阅名称 (name=名称) 或 远程订阅链接 (url=地址)')
}

const sourceType = /^1$|col|组合/i.test(type ?? '')
  ? 'collection'
  : 'subscription'

const artifactOptions = {
  name: subName || '临时订阅',
  type: sourceType,
  platform: 'Surge',
  produceOpts: {
    'include-unsupported-proxy': includeUnsupportedProxy,
  },
}

// 若提供了 url 则使用图片中的远程抓取逻辑，否则使用 Sub-Store 本地保存的订阅
if (subUrl) {
  artifactOptions.subscription = {
    name: subName || '临时订阅',
    url: subUrl,
    source: 'remote',
  }
}

// 1. 获取节点
const generated = await produceArtifact(artifactOptions)

function sectionRange(text, section) {
  const header = new RegExp(`^\\s*\\[${section.replace(/[.*+?^${}()\vert{}[\\]\\\\]/g, '\\$&')}\\]\\s*$`, 'im')
  const match = header.exec(text)
  if (!match) return null
  const bodyStart = match.index + match[0].length
  const nextHeader = /^\s*\[[^\]\r\n]+\]\s*$/gim
  nextHeader.lastIndex = bodyStart
  const next = nextHeader.exec(text)
  return { start: bodyStart, end: next ? next.index : text.length }
}

const generatedProxyRange = sectionRange(generated, 'Proxy')
const generatedProxyText = generatedProxyRange
  ? generated.slice(generatedProxyRange.start, generatedProxyRange.end)
  : generated

const proxyLines = generatedProxyText
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#') && !/^\[.+\]$/.test(line))
  .filter(line => /^[^=\r\n]+\s*=\s*[^,\r\n]+\s*,/.test(line))

// 2. 提取节点名称
const nodeNames = proxyLines.map(line => line.slice(0, line.indexOf('=')).trim())
if (!nodeNames.length) {
  throw new Error('订阅没有生成可用的 Surge 节点')
}

const templateProxyRange = sectionRange(config, 'Proxy')
const groupRange = sectionRange(config, 'Proxy Group')
if (!templateProxyRange || !groupRange) {
  throw new Error('模板必须同时包含 [Proxy] 和 [Proxy Group] 区段')
}

let groupBody = config.slice(groupRange.start, groupRange.end)

// 3. 追加节点名称到 “✈️ 我的节点 = smart”
const targetGroupPattern = /^(\s*✈️\s*我的节点\s*=\s*[^,\r\n]+,?)(.*)$/m
const targetGroup = targetGroupPattern.exec(groupBody)

if (!targetGroup) {
  throw new Error('模板 [Proxy Group] 中缺少“✈️ 我的节点”策略组')
}

// 移除可能占位的 policy-path 参数
const rawParams = targetGroup[2]
  .replace(/,\s*policy-path\s*=\s*[^,\r\n]+/gi, '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean)

const settingStart = rawParams.findIndex(v => /^[a-z-]+\s*=/.test(v))
const settings = settingStart === -1 ? [] : rawParams.slice(settingStart)

// 组合新的节点列表
const updatedGroupLine = `${targetGroup[1]}${[...nodeNames, ...settings].join(', ')}`
groupBody = groupBody.replace(targetGroup[0], updatedGroupLine)

// 4. 重构并写回配置文件
config = config.slice(0, groupRange.start) + groupBody + config.slice(groupRange.end)

const refreshedProxyRange = sectionRange(config, 'Proxy')
config = config.slice(0, refreshedProxyRange.start)
  + `\n${proxyLines.join('\n')}\n`
  + config.slice(refreshedProxyRange.end)

$content = config