// Sub-Store Surge 配置模板节点注入脚本
// 参数说明：
// - name: Sub-Store 中的订阅/组合名称（可选，填写后自动提取节点写入 [Proxy]）
// - url:  远程订阅 URL 链接（可选，填写后自动设置 ✈️ 远程节点 的 policy-path）
// - type: 组合订阅时传入 type=组合 或 col
// - includeUnsupportedProxy: 是否包含不支持的代理协议

const { name, type, url, includeUnsupportedProxy } = $arguments

let config = $content ?? $files?.[0]
if (typeof config !== 'string' || !config.trim()) {
  throw new Error('请将 Surge 配置模板作为内容或第一个文件传入')
}

if (!url && !name) {
  throw new Error('请在脚本参数中至少填写 name 或 url')
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

const templateProxyRange = sectionRange(config, 'Proxy')
const groupRange = sectionRange(config, 'Proxy Group')
if (!templateProxyRange || !groupRange) {
  throw new Error('模板必须同时包含 [Proxy] 和 [Proxy Group] 区段')
}

let proxyLines = []
let nodeNames = []

// 1. 如果传入 name=，获取节点写入 [Proxy]
if (name) {
  const sourceType = /^1$|col|组合/i.test(type ?? '')
    ? 'collection'
    : 'subscription'

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

let groupBody = config.slice(groupRange.start, groupRange.end)

// 2. 处理 ✈️ 远程节点 (url=)
const remoteGroupPattern = /^(\s*✈️\s*远程节点\s*=\s*[^,\r\n]+,?)(.*)$/m
const remoteMatch = remoteGroupPattern.exec(groupBody)

if (url) {
  if (remoteMatch) {
    let line = remoteMatch[0]
    if (/policy-path\s*=/i.test(line)) {
      line = line.replace(/policy-path\s*=\s*[^,\r\n]+/i, `policy-path=${url}`)
    } else {
      line = line.replace(/(\s*✈️\s*远程节点\s*=\s*smart,)/i, `$1 policy-path=${url},`)
    }
    groupBody = groupBody.replace(remoteMatch[0], line)
  }
} else {
  // 未传入 url= 时，移除远程节点定义并让地区策略组直接使用本地节点
  if (remoteMatch) {
    groupBody = groupBody.replace(remoteMatch[0], '')
  }
  groupBody = groupBody.replace(/,\s*"✈️\s*远程节点"/g, '')
  groupBody = groupBody.replace(/,\s*✈️\s*远程节点/g, '')
  groupBody = groupBody.replace(/include-other-group\s*=\s*✈️\s*远程节点/g, 'include-all-proxies=1')
}

// 3. 处理 节点｜选择 策略组 (追加本地节点)
const selectGroupPattern = /^(\s*节点｜选择\s*=\s*select\s*,)(.*)$/m
const selectMatch = selectGroupPattern.exec(groupBody)

if (selectMatch) {
  const rawParams = selectMatch[2]
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)

  const firstParamIdx = rawParams.findIndex(v => /^[a-zA-Z0-9-]+\s*=/.test(v))
  const currentMembers = firstParamIdx === -1 ? rawParams : rawParams.slice(0, firstParamIdx)
  const settings = firstParamIdx === -1 ? [] : rawParams.slice(firstParamIdx)

  const members = [...new Set([...currentMembers, ...nodeNames])]
  const updatedSelectLine = `${selectMatch[1]} ${[...members, ...settings].join(', ')}`
  groupBody = groupBody.replace(selectMatch[0], updatedSelectLine)
}

// 4. 更新 [Proxy Group] 和 [Proxy] 区段内容
config = config.slice(0, groupRange.start) + groupBody + config.slice(groupRange.end)

const refreshedProxyRange = sectionRange(config, 'Proxy')
if (refreshedProxyRange) {
  const proxyText = proxyLines.length ? `\n${proxyLines.join('\n')}\n` : '\n'
  config = config.slice(0, refreshedProxyRange.start) + proxyText + config.slice(refreshedProxyRange.end)
}

$content = config