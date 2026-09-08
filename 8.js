// Sub-Store Surge 仅提取节点名称并生成新文件脚本
// 参数：name=Sub-Store 中的订阅名称
// 组合订阅额外传入：type=组合订阅
// 远程抓取改传：url=订阅链接

const { name, type, url, includeUnsupportedProxy } = $arguments

const sourceType = /^1$|col|组合/i.test(type ?? '')
  ? 'collection'
  : 'subscription'

if (!url && !name) {
  throw new Error('请在脚本参数中填写 Sub-Store 订阅名称：name 或 url')
}

const artifactOptions = {
  name,
  type: sourceType,
  platform: 'Surge',
  produceOpts: {
    'include-unsupported-proxy': includeUnsupportedProxy,
  },
}

// 依据是否传入 url 判断是否为直接抓取远程链接
if (url) {
  artifactOptions.subscription = {
    name: name || '临时订阅',
    url,
    source: 'remote',
  }
}

// 1. 获取订阅抓取到的节点（根据参数判定远程或本地）
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

// 过滤出标准的 Surge 节点行
const proxyLines = generatedProxyText
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#') && !/^\[.+\]$/.test(line))
  .filter(line => /^[^=\r\n]+\s*=\s*[^,\r\n]+\s*,/.test(line))

// 2. 提取所有抓取到的节点名称
const nodeNames = proxyLines.map(line => line.slice(0, line.indexOf('=')).trim())

if (!nodeNames.length) {
  throw new Error('订阅没有生成可用的 Surge 节点')
}

// 3. 重新生成全新的文件内容（仅保留你要求的策略组与节点名称）
const newContent = `✈️ 我的节点 = smart, ${nodeNames.join(', ')}`

// 如果需要标准的 Surge 格式包含区段头，可以取消下方注释替换上一行：
// const newContent = `[Proxy Group]\n✈️ 我的节点 = smart, ${nodeNames.join(', ')}`

$content = newContent