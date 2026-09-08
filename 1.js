// Sub-Store Surge 配置模板注入脚本（稳定版）
// 逻辑：
// 1) name= -> 生成节点，写入 [Proxy]
// 2) url=  -> 只更新“✈️ 远程节点”的 policy-path
// 3) 自动把 name 生成的节点 + “✈️ 远程节点” 加入“节点｜选择”
// 4) 即使模板里某个区段格式稍有变化，也尽量不报错

const { name, type, url, includeUnsupportedProxy } = $arguments;

let config = $content ?? $files?.[0];
if (typeof config !== 'string' || !config.trim()) {
  throw new Error('请将 Surge 配置模板作为内容或第一个文件传入');
}

const hasName = typeof name === 'string' && name.trim();
const remotePolicyPath = typeof url === 'string' && url.trim() ? url.trim() : '';
const includeUnsupported = /^(1|true|yes|on)$/i.test(String(includeUnsupportedProxy ?? ''));

if (!hasName && !remotePolicyPath) {
  throw new Error('请至少提供 name 或 url 其中一个参数');
}

const sourceType = /^1$|col|组合/i.test(type ?? '') ? 'collection' : 'subscription';

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sectionRange(text, section) {
  const header = new RegExp(`^\\s*\\[${escapeRegExp(section)}\\]\\s*$`, 'im');
  const match = header.exec(text);
  if (!match) return null;

  const bodyStart = match.index + match[0].length;
  const nextHeader = /^\\s*\\[[^\\]\\r\\n]+\\]\\s*$/gim;
  nextHeader.lastIndex = bodyStart;
  const next = nextHeader.exec(text);

  return { start: bodyStart, end: next ? next.index : text.length };
}

function replaceOrAppendSection(text, section, newBody) {
  const range = sectionRange(text, section);
  const body = (newBody ?? '').replace(/^\n+|\n+$/g, '');
  const replacement = body ? `\n${body}\n` : '\n';

  if (range) {
    return text.slice(0, range.start) + replacement + text.slice(range.end);
  }

  return text.trimEnd() + `\n\n[${section}]\n${body ? body + '\n' : ''}`;
}

function ensureProxyLines(generated) {
  const proxyRange = sectionRange(generated, 'Proxy');
  const proxyText = proxyRange
    ? generated.slice(proxyRange.start, proxyRange.end)
    : generated;

  return proxyText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !/^\[.+\]$/.test(line))
    .filter(line => /^[^=\r\n]+\s*=\s*[^,\r\n]+\s*,/.test(line));
}

function upsertRemotePolicyPath(text, policyPath) {
  if (!policyPath) return text;

  const targetRegex = /^(\s*✈️\s*远程节点\s*=\s*smart\s*,\s*)(.*)$/m;
  const match = targetRegex.exec(text);

  if (match) {
    const tail = match[2];
    let updatedTail;
    if (/policy-path\s*=/.test(tail)) {
      updatedTail = tail.replace(/policy-path\s*=\s*[^,]+/, `policy-path=${policyPath}`);
    } else {
      updatedTail = `policy-path=${policyPath}${tail ? ', ' + tail.trimStart() : ''}`;
    }
    return text.replace(match[0], `${match[1]}${updatedTail}`);
  }

  // 如果没找到，就尝试插入到 [Proxy Group] 末尾
  const groupRange = sectionRange(text, 'Proxy Group');
  if (groupRange) {
    const body = text.slice(groupRange.start, groupRange.end).replace(/\n+$/, '');
    const insertLine = `✈️ 远程节点 = smart, policy-path=${policyPath}, update-interval=0, no-alert=0, hidden=0, include-all-proxies=0, icon-url=https://raw.githubusercontent.com/Semporia/Hand-Painted-icon/master/Universal/Final.png`;
    const newBody = body ? `${body}\n${insertLine}` : insertLine;
    return text.slice(0, groupRange.start) + `\n${newBody}\n` + text.slice(groupRange.end);
  }

  // 再不行就直接追加一个 [Proxy Group]
  return text.trimEnd() + `\n\n[Proxy Group]\n✈️ 远程节点 = smart, policy-path=${policyPath}, update-interval=0, no-alert=0, hidden=0, include-all-proxies=0, icon-url=https://raw.githubusercontent.com/Semporia/Hand-Painted-icon/master/Universal/Final.png\n`;
}

function upsertNodeSelectGroup(text, membersToAdd) {
  if (!membersToAdd.length) return text;

  const selectRegex = /^(\s*节点｜选择\s*=\s*select\s*,?)(.*)$/m;
  const match = selectRegex.exec(text);

  if (match) {
    const existingParts = match[2]
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);

    const settingStart = existingParts.findIndex(value => /^[a-z-]+\s*=/.test(value));
    const settings = settingStart === -1 ? [] : existingParts.slice(settingStart);
    const currentMembers = settingStart === -1 ? existingParts : existingParts.slice(0, settingStart);

    const members = [...new Set([...membersToAdd, ...currentMembers])];
    const updatedLine = `${match[1]} ${[...members, ...settings].join(', ')}`;
    return text.replace(match[0], updatedLine);
  }

  // 如果没找到，就插入到 [Proxy Group] 末尾
  const groupRange = sectionRange(text, 'Proxy Group');
  const newLine = `节点｜选择 = select, ${[...new Set(membersToAdd)].join(', ')}, icon-url=https://raw.githubusercontent.com/Rabbit-Spec/Surge/Master/Conf/icon/Surge.png`;

  if (groupRange) {
    const body = text.slice(groupRange.start, groupRange.end).replace(/\n+$/, '');
    const newBody = body ? `${body}\n${newLine}` : newLine;
    return text.slice(0, groupRange.start) + `\n${newBody}\n` + text.slice(groupRange.end);
  }

  return text.trimEnd() + `\n\n[Proxy Group]\n${newLine}\n`;
}

// 1) name -> 生成节点并写入 [Proxy]
let injectedNodeNames = [];
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
  const proxyLines = ensureProxyLines(generated);

  if (!proxyLines.length) {
    throw new Error('订阅没有生成可用的 Surge 节点，已停止输出以避免配置回落为直连');
  }

  injectedNodeNames = proxyLines.map(line => line.slice(0, line.indexOf('=')).trim());
  config = replaceOrAppendSection(config, 'Proxy', proxyLines.join('\n'));
}

// 2) url -> 仅更新远程 smart 的 policy-path
if (remotePolicyPath) {
  config = upsertRemotePolicyPath(config, remotePolicyPath);
}

// 3) 把本地节点名 + 远程节点加入“节点｜选择”
const selectMembers = [
  ...injectedNodeNames,
  ...(remotePolicyPath ? ['✈️ 远程节点'] : []),
];

config = upsertNodeSelectGroup(config, selectMembers);

$content = config;