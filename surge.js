// Sub-Store Surge 配置模板节点注入脚本
// 参数：
//   name: Sub-Store 中的订阅名称
//   url: 订阅 URL
//   type: 组合订阅标识（如 'col' 或 '组合'）
//   includeUnsupportedProxy: 是否包含未支持节点

const { name, type, url, includeUnsupportedProxy } = $arguments

let config = $content ?? $files?.[0]
if (typeof config !== 'string' || !config.trim()) {
  throw new Error('请将 Surge 配置模板作为内容或第一个文件传入')
}

if (!url && !name) {
  throw new Error('请在脚本参数中填写 Sub-Store 订阅名称 (name) 或 订阅链接 (url)')
}

const sourceType = /^1$|col|组合/i.test(type ?? '')
  ? 'collection'
  : 'subscription'

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

let proxyLines = []
let nodeNames = []

// 当传入 name 时，从 Sub-Store 生成节点列表并准备写入 [Proxy]
if (name) {
  const artifactOptions = {
    name,
    type: sourceType,
    platform: 'Surge',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupportedProxy,
    },
  }

  const generated = await produceArtifact(artifactOptions)

  const generatedProxyRange = sectionRange(generated, 'Proxy')
  const generatedProxyText = generatedProxyRange
    ? generated.slice(generatedProxyRange.start, generatedProxyRange.end)
    : generated

  proxyLines = generatedProxyText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !/^\[.+\]$/.test(line))
    .filter(line => /^[^=\r\n]+\s*=\s*[^,\r\n]+\s*,/.test(line))

  nodeNames = proxyLines.map(line => line.slice(0, line.indexOf('=')).trim())
  if (!nodeNames.length) {
    throw new Error('订阅没有生成可用的 Surge 节点，已停止输出以避免配置回落为直连')
  }
}

// 检查模板区段
const groupRange = sectionRange(config, 'Proxy Group')
if (!groupRange) {
  throw new Error('模板必须包含 [Proxy Group] 区段')
}

if (name) {
  const templateProxyRange = sectionRange(config, 'Proxy')
  if (!templateProxyRange) {
    throw new Error('模板在包含 name 参数时必须包含 [Proxy] 区段')
  }
}

// 定位“远程｜节点”策略组
const nodeGroupPattern = /^(\s*远程｜节点\s*=\s*)([^\r\n]+)$/m
const groupBody = config.slice(groupRange.start, groupRange.end)
const nodeGroup = nodeGroupPattern.exec(groupBody)
if (!nodeGroup) {
  throw new Error('模板 [Proxy Group] 中缺少“远程｜节点”策略组')
}

const rawParts = nodeGroup[2].split(',').map(value => value.trim()).filter(Boolean)
const restParts = rawParts.slice(1) // 排除原策略类型

// 分离 existing settings（如 policy-path=... 等参数）与普通节点成员
let settings = restParts.filter(value => /^[a-z-]+\s*=/i.test(value))
let currentMembers = restParts.filter(value => !/^[a-z-]+\s*=/i.test(value))

let updatedGroupLine = ''

if (url) {
  // 包含 url 时：远程｜节点 指向 policy-path=url
  settings = settings.filter(s => !/^policy-path\s*=/i.test(s))
  settings.push(`policy-path=${url}`)

  const groupItems = [...currentMembers, ...settings].filter(Boolean)
  updatedGroupLine = `${nodeGroup[1]}smart${groupItems.length ? ', ' + groupItems.join(', ') : ''}`
} else {
  // 仅有 name 时：自动提取远程节点名称追加到可选节点列表中
  settings = settings.filter(s => !/^policy-path\s*=/i.test(s))
  const members = [...new Set([...nodeNames, ...currentMembers])]
  const groupItems = [...members, ...settings].filter(Boolean)
  updatedGroupLine = `${nodeGroup[1]}smart${groupItems.length ? ', ' + groupItems.join(', ') : ''}`
}

const updatedGroupBody = groupBody.replace(nodeGroup[0], updatedGroupLine)

// 替换 [Proxy Group] 区段内容
config = config.slice(0, groupRange.start) + updatedGroupBody + config.slice(groupRange.end)

// 若有 name，将自动生成的节点写入 [Proxy]
if (name && proxyLines.length) {
  const refreshedProxyRange = sectionRange(config, 'Proxy')
  if (refreshedProxyRange) {
    config = config.slice(0, refreshedProxyRange.start)
      + `\n${proxyLines.join('\n')}\n`
      + config.slice(refreshedProxyRange.end)
  }
}

$content = config