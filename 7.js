// Sub-Store Surge 配置模板：仅提取远程订阅 (url) 节点注入至 [✈️ 我的节点]

const { name, url, includeUnsupportedProxy } = $arguments

// 1. 严格限制：必须存在远程 url
const remoteUrl = url || (typeof $subscription !== 'undefined' && $subscription.source === 'remote' ? $subscription.url : null)

if (!remoteUrl) {
  throw new Error('【错误】此脚本仅用于处理远程订阅！请在快捷脚本参数中明确填写 url=远程订阅地址')
}

let config = $content ?? $files?.[0]
if (typeof config !== 'string' || !config.trim()) {
  throw new Error('请将 Surge 配置模板作为内容或第一个文件传入')
}

// 强制只指定 remote 来源，绝不读取 Sub-Store 的本地/组合订阅
const artifactOptions = {
  name: name || '远程订阅',
  platform: 'Surge',
  produceOpts: {
    'include-unsupported-proxy': includeUnsupportedProxy,
  },
  subscription: {
    name: name || '远程订阅',
    url: remoteUrl,
    source: 'remote',
  },
}

// 2. 抓取远程 URL 节点
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

const generatedProxyRange = sectionRange(generated, 'Proxy')
const generatedProxyText = generatedProxyRange
  ? generated.slice(generatedProxyRange.start, generatedProxyRange.end)
  : generated

const proxyLines = generatedProxyText
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#') && !/^\[.+\]$/.test(line))
  .filter(line => /^[^=\r\n]+\s*=\s*[^,\r\n]+\s*,/.test(line))

// 仅提取抓取到的远程节点名称
const remoteNodeNames = proxyLines.map(line => line.slice(0, line.indexOf('=')).trim())
if (!remoteNodeNames.length) {
  throw new Error('远程订阅 URL 未能解析出任何有效节点')
}

const groupRange = sectionRange(config, 'Proxy Group')
if (!groupRange) {
  throw new Error('模板必须包含 [Proxy Group] 区段')
}

let groupBody = config.slice(groupRange.start, groupRange.end)

// 3. 定位 “✈️ 我的节点 = smart” 策略组
const targetGroupPattern = /^(\s*✈️\s*我的节点\s*=\s*smart\s*,?)(.*)$/m
const targetGroup = targetGroupPattern.exec(groupBody)

if (!targetGroup) {
  throw new Error('模板 [Proxy Group] 中未找到 “✈️ 我的节点 = smart” 策略组')
}

// 剔除占位的 policy-path=... 字段
const rawParams = targetGroup[2]
  .replace(/,\s*policy-path\s*=\s*[^,\r\n]+/gi, '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean)

const settingStart = rawParams.findIndex(v => /^[a-z-]+\s*=/.test(v))
const settings = settingStart === -1 ? [] : rawParams.slice(settingStart)
const existingMembers = settingStart === -1 ? rawParams : rawParams.slice(0, settingStart)

// 仅把解析出来的远程节点名称追加到 ✈️ 我的节点 策略组中
const members = [...new Set([...existingMembers, ...remoteNodeNames])]
const updatedGroupLine = `${targetGroup[1]} ${[...members, ...settings].join(', ')}`
groupBody = groupBody.replace(targetGroup[0], updatedGroupLine)

// 4. 重构并输出配置
config = config.slice(0, groupRange.start) + groupBody + config.slice(groupRange.end)

const refreshedProxyRange = sectionRange(config, 'Proxy')
if (refreshedProxyRange) {
  config = config.slice(0, refreshedProxyRange.start)
    + `\n${proxyLines.join('\n')}\n`
    + config.slice(refreshedProxyRange.end)
}

$content = config