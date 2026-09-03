// Sub-Store Surge 配置模板节点注入脚本
// 参数：name=Sub-Store 中的订阅名称
// 组合订阅额外传入：type=组合订阅
// 也可不用已保存订阅，改传：url=订阅链接
const { name, type, url } = $arguments

// 解析 Surge 模板配置文件（纯文本）
let configText = $content ?? $files[0]
if (!configText || typeof configText !== 'string') {
  throw new Error('未读取到有效的 Surge 模板内容')
}

const sourceType = /^1$|col|组合/i.test(type ?? '') ? 'collection' : 'subscription'
if (!url && !name) {
  throw new Error('请在脚本参数中填写 Sub-Store 订阅名称：name')
}

// 1. 调用 Sub-Store 内置方法生成 Surge 格式的节点
const artifactOptions = {
  name,
  type: sourceType,
  platform: 'Surge',
}

if (url) {
  artifactOptions.subscription = {
    name: name || '临时订阅',
    url,
    source: 'remote',
  }
}

// 生成出来的结果是纯文本，通常一行一个节点
const generatedProxiesText = await produceArtifact(artifactOptions)
if (!generatedProxiesText || !generatedProxiesText.trim()) {
  throw new Error('订阅没有生成可用的 Surge 节点，已停止输出以避免配置回落')
}

// 提取所有生成的节点名称（用于注入策略组）
const nodeTags = generatedProxiesText
  .split('\n')
  .map(line => {
    const trimmed = line.trim()
    if (!trimmed  trimmed.startsWith('#')  trimmed.startsWith('//')) return null
    // Surge 节点格式通常为: 节点名 = type, server, ...
    const match = trimmed.match(/^([^=]+)=/)
    return match ? match[1].trim() : null
  })
  .filter(Boolean)

if (nodeTags.length === 0) {
  throw new Error('未能正确解析出生成的 Surge 节点名称')
}

// 2. 将节点列表转换为 Surge 策略组所需的逗号分隔字符串
const nodeTagsString = nodeTags.join(', ')

// 3. 已修改：定义你需要注入节点的目标策略组名称
const targetGroups = ['节点｜选择', '谷歌｜服务']
let matchedGroups = 0

// 使用正则在 [Proxy Group] 这一行之后进行替换修改
for (const groupName of targetGroups) {
  // 匹配特定策略组的正则表达式
  const groupRegex = new RegExp(`(^\\s*${groupName}\\s*=\\s*(?:select|url-test|fallback|ssid)[^\\n]*)`, 'm')
  
  if (groupRegex.test(configText)) {
    // 将原策略组整行后面，直接追加生成的节点列表
    configText = configText.replace(groupRegex, `$1, ${nodeTagsString}`)
    matchedGroups++
  }
}

if (matchedGroups !== targetGroups.length) {
  throw new Error(`模板必须同时包含指定的策略组：${targetGroups.join(' 和 ')}`)
}

// 4. 将提取出的节点追加到 [Proxy] 段落中
const proxySectionRegex = /^\[Proxy\]\s*$/m
if (!proxySectionRegex.test(configText)) {
  throw new Error('模板中缺少 [Proxy] 段落，无法注入节点')
}

// 在 [Proxy] 下方插入生成的节点文本
configText = configText.replace(proxySectionRegex, `[Proxy]\n${generatedProxiesText}\n`)

// 输出最终的 Surge 配置
$content = configText