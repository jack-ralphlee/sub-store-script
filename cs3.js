// Sub-Store Surge 快捷脚本：填充 policy-path 远程订阅链接
// 使用方法：在 Sub-Store 脚本参数中传入 url=你的订阅链接

const { url } = $arguments

let config = $content ?? $files?.[0]
if (typeof config !== 'string' || !config.trim()) {
  throw new Error('请将 Surge 配置模板作为内容或第一个文件传入')
}

// 获取传入的远程订阅 URL
const subUrl = url || $arguments.subUrl
if (!subUrl) {
  throw new Error('请在脚本参数中填写远程订阅地址，格式：url=https://xxx.com/sub')
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

// 匹配 ✈️ 我的节点 行并替换 policy-path= 的值
const targetPattern = /^(\s*✈️\s*我的节点\s*=.*?\bpolicy-path\s*=\s*)[^,\r\n]+(.*)$/m

if (targetPattern.test(groupBody)) {
  groupBody = groupBody.replace(targetPattern, `$1${subUrl}$2`)
} else {
  throw new Error('未在 [Proxy Group] 中找到带有 policy-path 的 “✈️ 我的节点” 策略组')
}

// 重新拼接配置内容
config = config.slice(0, groupRange.start) + groupBody + config.slice(groupRange.end)

$content = config