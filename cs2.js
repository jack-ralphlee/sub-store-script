// Sub-Store Surge 配置模板节点注入脚本 (policy-path 模式)
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
  throw new Error('请在脚本参数中填写 Sub-Store 订阅名称：name 或直接传入 url')
}

const artifactOptions = {
  name,
  type: sourceType,
  platform: 'Surge',
  produceOpts: {
    'include-unsupported-proxy': includeUnsupportedProxy,
  },
}

// 获取订阅 URL（优先使用传入的 url，否则调用 Sub-Store 内置函数或从参数获取）
let subUrl = url
if (!subUrl && typeof getArtifactUrl === 'function') {
  subUrl = await getArtifactUrl(artifactOptions)
}
if (!subUrl) {
  subUrl = $arguments.subUrl
}
if (!subUrl) {
  throw new Error('无法获取订阅 URL，请检查参数 name/url 是否正确')
}

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

const groupRange = sectionRange(config, 'Proxy Group')
if (!groupRange) {
  throw new Error('模板必须包含 [Proxy Group] 区段')
}

let groupBody = config.slice(groupRange.start, groupRange.end)

// 1. 设置/更新 “✈️ 我的节点 = smart, policy-path=...”
const myNodeGroupPattern = /^\s*✈️\s*我的节点\s*=.*$/m
const myNodeGroupLine = `✈️ 我的节点 = smart, policy-path=${subUrl}`

if (myNodeGroupPattern.test(groupBody)) {
  groupBody = groupBody.replace(myNodeGroupPattern, myNodeGroupLine)
} else {
  groupBody = groupBody.trimEnd() + `\n${myNodeGroupLine}\n`
}

// 2. 如果模板存在 “节点｜选择 = select”，自动将 “✈️ 我的节点” 加入选择列表首位
const nodeGroupPattern = /^(\s*节点｜选择\s*=\s*select\s*,?)(.*)$/m
const nodeGroup = nodeGroupPattern.exec(groupBody)
if (nodeGroup) {
  const existingParts = nodeGroup[2].split(',').map(v => v.trim()).filter(Boolean)
  const settingStart = existingParts.findIndex(v => /^[a-z-]+\s*=/.test(v))
  const settings = settingStart === -1 ? [] : existingParts.slice(settingStart)
  const currentMembers = settingStart === -1 ? existingParts : existingParts.slice(0, settingStart)

  if (!currentMembers.includes('✈️ 我的节点')) {
    currentMembers.unshift('✈️ 我的节点')
  }

  const updatedGroupLine = `${nodeGroup[1]} ${[...currentMembers, ...settings].join(', ')}`
  groupBody = groupBody.replace(nodeGroup[0], updatedGroupLine)
}

// 替换更新后的 [Proxy Group] 区段内容
config = config.slice(0, groupRange.start) + groupBody + config.slice(groupRange.end)

$content = config