// Sub-Store Surge 配置模板修改脚本
// 功能：仅替换配置模板中的远程订阅 API 链接，不解析和注入任何静态节点

let config = $content ?? $files[0]
if (typeof config !== 'string' || !config.trim()) {
  throw new Error('模板不是合法的字符串配置，无法解析为 Surge 配置')
}

// 目标远程订阅 API 链接
const customApiUrl = 'https://omega-7nd.pages.dev/sub?token=7fa81beeed2915962aab9bab27550abf'

// 1. 定位“✈️ 我的节点”所在行，精准替换 policy-path= 后面的地址
config = config.replace(
  /^(\s*✈️ 我的节点\s*=.*?\bpolicy-path=)[^,\r\n]+/m,
  `$1${customApiUrl}`
)

// 2. 兜底替换配置文本中剩余的“你的订阅地址”占位符
config = config.replace(/你的订阅地址/g, customApiUrl)

$content = config