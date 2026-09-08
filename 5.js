// Sub-Store Surge 配置模板节点注入脚本（仅针对 url 远程订阅）
// 参数：url=远程订阅链接 (必填)，name=订阅名称 (可选)

const { name, url, includeUnsupportedProxy } = $arguments

if (!url) {
  throw new Error('请在脚本参数中填写远程订阅地址：url=https://xxx.com/sub')
}

let config = $content ?? $files?.[0]
if (typeof config !== 'string' || !config.trim()) {
  throw new Error('请将 Surge 配置模板作为内容或第一个文件传入')
}

// 对应图片中的远程订阅配置结构
const artifactOptions = {
  name: name || '临时订阅',
  platform: 'Surge',
  produceOpts: {
    'include-unsupported-proxy': includeUnsupportedProxy,
  },
  subscription: {
    name: name || '临时订阅',
    url,
    source: 'remote',
  },
}

// 1. 抓取 url 对应的远程订阅节点
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

// 2. 提取抓取到的远程节点名称
const nodeNames = proxyLines.map(line => line.slice(0, line.indexOf('=')).trim())
if (!nodeNames.length) {
  throw new Error('远程订阅 url 没有生成可用的 Surge 节点')
}

const templateProxyRange = sectionRange(config, 'Proxy')
const groupRange = sectionRange(config, 'Proxy Group')
if (!templateProxyRange || !groupRange) {
  throw new Error('模板必须同时包含 [Proxy] 和 [Proxy Group] 区段')
}

let groupBody = config.slice(groupRange.start, groupRange.end)

// 3. 将远程节点名称注入到 “✈️ 我的节点 = smart” 后面
const targetGroupPattern = /^(\s*✈️\s*我的节点\s*=\s*[^,\r\n]+,?)(.*)$/m
const targetGroup = targetGroupPattern.exec(groupBody)

if (!targetGroup) {
  throw new Error('模板 [Proxy Group] 中缺少“✈️ 我的节点”策略组')
}

// 自动移除占位的 policy-path=xxx
const rawParams = targetGroup[2]
  .replace(/,\s*policy-path\s*=\s*[^,\r\n]+/gi, '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean)

const settingStart = rawParams.findIndex(v => /^[a-z-]+\s*=/.test(v))
const settings = settingStart === -1 ? [] : rawParams.slice(settingStart)

// 拼接仅包含远程抓取节点名的策略组行
const updatedGroupLine = `${targetGroup[1]} ${[...nodeNames, ...settings].join(', ')}`
groupBody = groupBody.replace(targetGroup[0], updatedGroupLine)

// 4. 重新组合配置文件，将节点明文填入 [Proxy]，将策略写入 [Proxy Group]
config = config.slice(0, groupRange.start) + groupBody + config.slice(groupRange.end)

const refreshedProxyRange = sectionRange(config, 'Proxy')
config = config.slice(0, refreshedProxyRange.start)
  + `\n${proxyLines.join('\n')}\n`
  + config.slice(refreshedProxyRange.end)

$content = config