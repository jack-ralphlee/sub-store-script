// Sub-Store sing-box 1.14 配置模板节点注入脚本
// 参数：name=Sub-Store 中的订阅名称
// 组合订阅额外传入：type=组合订阅
// 也可不用已保存订阅，改传：url=订阅链接
const { name, type, url, includeUnsupportedProxy } = $arguments
const parser = ProxyUtils.JSON5 || JSON
let config
try {
  config = parser.parse($content ?? $files[0]) } catch (error) {
  throw new Error(`模板不是合法 JSON/JSON5：${error.message ?? error}`)
}

const sourceType = /^1$|col|组合/i.test(type ?? '') ? 'collection' : 'subscription'
if (!url && !name) {
  throw new Error('请在脚本参数中填写 Sub-Store 订阅名称：name')
}

const artifactOptions = {
  name,
  type: sourceType,
  platform: 'sing-box',
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

const generated = JSON.parse(await produceArtifact(artifactOptions))
const nodeOutbounds = Array.isArray(generated.outbounds) ? generated.outbounds : []
const nodeEndpoints = Array.isArray(generated.endpoints) ? generated.endpoints : []

const nodeTags = [...nodeOutbounds, ...nodeEndpoints]
  .map(item => item && item.tag)
  .filter(Boolean)

if (nodeTags.length === 0) {
  throw new Error('订阅没有生成可用的 sing-box 节点，已停止输出以避免配置回落为直连')
}

if (!Array.isArray(config.outbounds)) {
  throw new Error('模板缺少 outbounds 数组')
}

// 修改此处：定义新的目标策略组标签
const targetTags = new Set(['📦 sing-box', '🟢 自动-测速'])
let matchedGroups = 0

for (const outbound of config.outbounds) {
  if (!targetTags.has(outbound.tag)) continue
  outbound.outbounds = [...new Set(nodeTags)]
  matchedGroups += 1
}

if (matchedGroups !== targetTags.size) {
  throw new Error('模板必须同时包含“📦 sing-box”和“🟢 自动-测速”两个策略组')
}

const reservedTags = new Set(config.outbounds.map(item => item.tag))
const collisions = nodeTags.filter(tag => reservedTags.has(tag))

if (collisions.length > 0) {
  throw new Error(`节点名称与模板策略组重名：${[...new Set(collisions)].join('、')}`)
}

config.outbounds.push(...nodeOutbounds)
config.endpoints = [
  ...(Array.isArray(config.endpoints) ? config.endpoints : []),
  ...nodeEndpoints,
]

$content = JSON.stringify(config, null, 2)
