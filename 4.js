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

// 1. 获取远程订阅抓取到的节点
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

// 提取所有抓取到的节点名称
const nodeNames = proxyLines.map(line => line.slice(0, line.indexOf('=')).trim())
if (!nodeNames.length) {
  throw new Error('订阅没有生成可用的 Surge 节点，已停止输出以避免配置回落为直连')
}

const templateProxyRange = sectionRange(config, 'Proxy')
const groupRange = sectionRange(config, 'Proxy Group')
if (!templateProxyRange || !groupRange) {
  throw new Error('模板必须同时包含 [Proxy] 和 [Proxy Group] 区段')
}

let groupBody = config.slice(groupRange.start, groupRange.end)

// 2. 定位并修改 “✈️ 我的节点 = smart, ...” 策略组
const targetGroupPattern = /^(\s*✈️\s*我的节点\s*=\s*[^,\r\n]+,?)(.*)$/m
const targetGroup = targetGroupPattern.exec(groupBody)

if (!targetGroup) {
  throw new Error('模板 [Proxy Group] 中缺少“✈️ 我的节点”策略组')
}

// 剔除原本占位的 policy-path=xxx 参数
const rawParams = targetGroup[2]
  .replace(/,\s*policy-path\s*=\s*[^,\r\n]+/gi, '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean)

// 分离设置参数（如 update-interval=0）和 原有的成员节点
const settingStart = rawParams.findIndex(v => /^[a-z-]+\s*=/.test(v))
const settings = settingStart === -1 ? [] : rawParams.slice(settingStart)
const currentMembers = settingStart === -1 ? rawParams : rawParams.slice(0, settingStart)

// 将远程节点名称合并追加进去
const members = [...new Set([...currentMembers, ...nodeNames])]

// 拼接并替换修改后的策略组行
const updatedGroupLine = `${targetGroup[1]} ${[...members, ...settings].join(', ')}`
groupBody = groupBody.replace(targetGroup[0], updatedGroupLine)

// 3. 更新 [Proxy Group] 和 [Proxy] 区段内容
config = config.slice(0, groupRange.start) + groupBody + config.slice(groupRange.end)

const refreshedProxyRange = sectionRange(config, 'Proxy')
config = config.slice(0, refreshedProxyRange.start)
  + `\n${proxyLines.join('\n')}\n`
  + config.slice(refreshedProxyRange.end)

$content = config