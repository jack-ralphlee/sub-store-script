// Sub-Store Surge 配置模板处理脚本
// 仅为 “✈️ 我的节点” 策略组配置远程订阅 API (policy-path)，不注入任何静态节点数据

let config = $content ?? $files[0]
if (typeof config !== 'string' || !config.trim()) {
  throw new Error('模板不是合法的字符串配置，无法解析为 Surge 配置')
}

// 辅助函数：定位 Surge 配置的区段（如 [Proxy Group]）
function findSection(text, sectionName) {
  const pattern = new RegExp(`^\\s*\\[${sectionName}\\]\\s*$`, 'im')
  const startMatch = pattern.exec(text)
  if (!startMatch) return null
  const start = startMatch.index + startMatch[0].length
  const followingHeader = /^\s*\[[^\]\r\n]+\]\s*$/gim
  followingHeader.lastIndex = start
  const endMatch = followingHeader.exec(text)
  return { start, end: endMatch ? endMatch.index : text.length }
}

// 定位模板 [Proxy Group] 区段
const groupSection = findSection(config, 'Proxy Group')

if (!groupSection) {
  throw new Error('模板必须包含 [Proxy Group] 区段')
}

// 获取策略组内容
let groupText = config.slice(groupSection.start, groupSection.end)

// 寻找目标策略组（基于特征：“✈️ 我的节点 = select”）
const groupPattern = /^(\s*✈️ 我的节点\s*=\s*select\s*,?)(.*)$/m
const groupMatch = groupPattern.exec(groupText)

if (!groupMatch) {
  throw new Error('模板 [Proxy Group] 中缺少“✈️ 我的节点 = select”策略组')
}

// 分离模板原有节点项与参数配置项[cite: 1]
const originalItems = groupMatch[2].split(',').map(item => item.trim()).filter(Boolean)
const firstSetting = originalItems.findIndex(item => /^[a-z-]+\s*=/.test(item))
const originalNodes = firstSetting === -1 ? originalItems : originalItems.slice(0, firstSetting)
const settings = firstSetting === -1 ? [] : originalItems.slice(firstSetting)

// 远程订阅 API 链接
const customApiUrl = 'https://omega-7nd.pages.dev/sub?token=7fa81beeed2915962aab9bab27550abf'

// 更新或设置 policy-path 参数
let hasPolicyPath = false
const updatedSettings = settings.map(s => {
  if (s.startsWith('policy-path')) {
    hasPolicyPath = true
    return `policy-path=${customApiUrl}`
  }
  return s
})

if (!hasPolicyPath) {
  updatedSettings.push(`policy-path=${customApiUrl}`)
}

// 重新组装策略组（仅保留原配置项及 policy-path，不注入任何静态节点）
const newGroupLine = `${groupMatch[1]} ${[...originalNodes, ...updatedSettings].join(', ')}`
const updatedGroups = groupText.replace(groupMatch[0], newGroupLine)

config = config.slice(0, groupSection.start) + updatedGroups + config.slice(groupSection.end)

// 全局替换模板中的占位符
config = config.replace(/policy-path=你的订阅地址/g, `policy-path=${customApiUrl}`)

$content = config