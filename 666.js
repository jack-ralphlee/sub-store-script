// Sub-Store Surge 配置模板注入脚本（智能版）
// 规则：
// 1) name=  -> 生成节点，写入 [Proxy]
// 2) url=   -> 仅写入 [Proxy Group] 中的 “✈️ 远程节点 = smart, policy-path=...”
// 3) name 和 url 可以同时存在：本地节点 + 远程 smart 策略同时生效
// 4) 自动把本地节点名和“✈️ 远程节点”加入 “节点｜选择”

const { name, type, url, includeUnsupportedProxy } = $arguments;

let config = $content ?? $files?.[0];
if (typeof config !== 'string' || !config.trim()) {
  throw new Error('请将 Surge 配置模板作为内容或第一个文件传入');
}

const hasName = typeof name === 'string' && name.trim();
const remotePolicyPath = typeof url === 'string' ? url.trim() : '';
const includeUnsupported = /^(1|true|yes|on)$/i.test(String(includeUnsupportedProxy ?? ''));

if (!hasName && !remotePolicyPath) {
  throw new Error('请至少提供 name 或 url 其中一个参数');
}

const sourceType = /^1$|col|组合/i.test(type ?? '') ? 'collection' : 'subscription';

function sectionRange(text, section) {
  const header = new RegExp(
    `^\\s*\\[${section.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\]\\s*$`,
    'im'
  );
  const match = header.exec(text);
  if (!match) return null;

  const bodyStart = match.index + match[0].length;
  const nextHeader = /^\\s*\\[[^\\]\\r\\n]+\\]\\s*$/gim;
  nextHeader.lastIndex = bodyStart;
  const next = nextHeader.exec(text);

  return { start: bodyStart, end: next ? next.index : text.length };
}

function replaceSectionBody(text, section, newBody) {
  const range = sectionRange(text, section);
  if (!range) {
    throw new Error(`模板中缺少 [${section}] 区段`);
  }

  const body = (newBody ?? '').replace(/^\n+|\n+$/g, '');
  const replacement = body ? `\n${body}\n` : '\n';
  return text.slice(0, range.start) + replacement + text.slice(range.end);
}

function extractGeneratedProxyLines(generated) {
  const proxyRange = sectionRange(generated, 'Proxy');
  const proxyText = proxyRange
    ? generated.slice(proxyRange.start, proxyRange.end)
    : generated;

  const proxyLines = proxyText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !/^\[.+\]$/.test(line))
    // Surge 节点一般为“名称 = 类型, 参数...”
    .filter(line => /^[^=\r\n]+\s*=\s*[^,\r\n]+\s*,/.test(line));

  return proxyLines;
}

function updateNodeSelectGroup(text, addMembers) {
  if (!addMembers.length) return text;

  const groupRange = sectionRange(text, 'Proxy Group');
  if (!groupRange) {
    throw new Error('模板必须同时包含 [Proxy] 和 [Proxy Group] 区段');
  }

  const groupBody = text.slice(groupRange.start, groupRange.end);
  const nodeGroupPattern = /^(\s*节点｜选择\s*=\s*select\s*,?)(.*)$/m;
  const match = nodeGroupPattern.exec(groupBody);

  if (!match) {
    throw new Error('模板 [Proxy Group] 中缺少“节点｜选择 = select”策略组');
  }

  const existingParts = match[2]
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  const settingStart = existingParts.findIndex(value => /^[a-z-]+\s*=/.test(value));
  const settings = settingStart === -1 ? [] : existingParts.slice(settingStart);
  const currentMembers = settingStart === -1 ? existingParts : existingParts.slice(0, settingStart);

  const members = [...new Set([...addMembers, ...currentMembers])];
  const updatedGroupLine = `${match[1]} ${[...members, ...settings].join(', ')}`;
  const updatedGroupBody = groupBody.replace(match[0], updatedGroupLine);

  return text.slice(0, groupRange.start) + updatedGroupBody + text.slice(groupRange.end);
}

function updateRemotePolicyPath(text, policyPath) {
  if (!policyPath) return text;

  const groupRange = sectionRange(text, 'Proxy Group');
  if (!groupRange) {
    throw new Error('模板必须同时包含 [Proxy] 和 [Proxy Group] 区段');
  }

  const groupBody = text.slice(groupRange.start, groupRange.end);
  const lineRegex = /^(\s*✈️\s*远程节点\s*=\s*smart\s*,\s*)(.*)$/m;
  const match = lineRegex.exec(groupBody);

  if (!match) {
    throw new Error('模板 [Proxy Group] 中缺少“✈️ 远程节点 = smart”策略行');
  }

  const prefix = match[1];
  const tail = match[2];

  let updatedTail;
  if (/policy-path\s*=/.test(tail)) {
    updatedTail = tail.replace(/policy-path\s*=\s*[^,]+/, `policy-path=${policyPath}`);
  } else {
    updatedTail = `policy-path=${policyPath}${tail ? ', ' + tail.trimStart() : ''}`;
  }

  const updatedLine = `${prefix}${updatedTail}`;
  const updatedBody = groupBody.replace(match[0], updatedLine);

  return text.slice(0, groupRange.start) + updatedBody + text.slice(groupRange.end);
}

let injectedNodeNames = [];

// 1) 只有 name 才生成本地节点并写入 [Proxy]
if (hasName) {
  const artifactOptions = {
    name: hasName,
    type: sourceType,
    platform: 'Surge',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupported,
    },
  };

  const generated = await produceArtifact(artifactOptions);
  const proxyLines = extractGeneratedProxyLines(generated);

  if (!proxyLines.length) {
    throw new Error('订阅没有生成可用的 Surge 节点，已停止输出以避免配置回落为直连');
  }

  injectedNodeNames = proxyLines.map(line => line.slice(0, line.indexOf('=')).trim());
  config = replaceSectionBody(config, 'Proxy', proxyLines.join('\n'));
}

// 2) url 只写入远程 smart 策略的 policy-path
if (remotePolicyPath) {
  config = updateRemotePolicyPath(config, remotePolicyPath);
}

// 3) 自动把“本地节点名”和“✈️ 远程节点”加入“节点｜选择”
const selectMembers = [
  ...injectedNodeNames,
  ...(remotePolicyPath ? ['✈️ 远程节点'] : []),
];

config = updateNodeSelectGroup(config, selectMembers);

$content = config;