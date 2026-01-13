import fs from 'fs';

function renderMarkdownToHTML(content, allNotes) {
  // コードブロックを一時退避
  const codeBlocks = [];
  let html = content.replace(/```([\s\S]*?)```/g, (match, code) => {
    const index = codeBlocks.length;
    codeBlocks.push(code);
    return `__CODE_BLOCK_${index}__`;
  });

  // インラインコードを一時退避
  const inlineCodes = [];
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    const index = inlineCodes.length;
    inlineCodes.push(code);
    return `__INLINE_CODE_${index}__`;
  });

  // エスケープ
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 見出し
  html = html
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>');

  // 装飾
  html = html
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/~~(.*?)~~/g, '<del>$1</del>');

  // 水平線
  html = html.replace(/^(---|\*\*\*)$/gm, '<hr>');

  // 行ごとに処理
  const lines = html.split('\n');
  const processedLines = [];
  
  let inTable = false;
  let tableBuffer = [];
  let inBlockquote = false;
  let blockquoteBuffer = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 表の処理
    if (line.includes('|')) {
      if (inBlockquote) {
        processedLines.push(`<blockquote>${blockquoteBuffer.join('<br>')}</blockquote>`);
        inBlockquote = false;
        blockquoteBuffer = [];
      }
      
      if (!inTable) {
        inTable = true;
        tableBuffer = [];
      }
      tableBuffer.push(line);
      continue;
    } else if (inTable) {
      processedLines.push(renderTable(tableBuffer));
      inTable = false;
      tableBuffer = [];
    }

    // 引用の処理
    if (line.startsWith('&gt; ')) {
      if (!inBlockquote) {
        inBlockquote = true;
        blockquoteBuffer = [];
      }
      blockquoteBuffer.push(line.substring(5));
      continue;
    } else if (inBlockquote) {
      processedLines.push(`<blockquote>${blockquoteBuffer.join('<br>')}</blockquote>`);
      inBlockquote = false;
      blockquoteBuffer = [];
    }

    // その他の行
    processedLines.push(line);
  }

  // 残りの引用があれば処理
  if (inBlockquote) {
    processedLines.push(`<blockquote>${blockquoteBuffer.join('<br>')}</blockquote>`);
  }

  // 残りの表があれば処理
  if (inTable) {
    processedLines.push(renderTable(tableBuffer));
  }

  html = processedLines.join('\n');

  // リストを構造化（入れ子対応）
  html = processNestedLists(html);

  // Markdown リンク
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // 素の URL をリンク化
  html = html.replace(/(?<!href="|src=")(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

  // Wikiリンク
  html = html.replace(/\[\[(.*?)\]\]/g, (match, title) => {
    const target = allNotes.find(n => n.title === title);
    return target 
      ? `<a href="${target.id}.html" class="wiki-link">${title}</a>`
      : title;
  });

  // コードブロックを復元
  codeBlocks.forEach((code, index) => {
    html = html.replace(`__CODE_BLOCK_${index}__`, 
      `<pre><code>${code}</code></pre>`);
  });

  // インラインコードを復元
  inlineCodes.forEach((code, index) => {
    html = html.replace(`__INLINE_CODE_${index}__`, 
      `<code>${code}</code>`);
  });

  // 改行
  html = html.replace(/\n/g, '<br>');

  return html;
}

function renderTable(lines) {
  if (lines.length < 2) return lines.join('\n');

  const rows = lines.map(line => 
    line.split('|')
      .map(cell => cell.trim())
      .filter((cell, i, arr) => i > 0 && i < arr.length - 1)
  );

  const isSeparator = rows[1] && rows[1].every(cell => /^:?-+:?$/.test(cell));

  let html = '<table>';

  if (isSeparator) {
    html += '<thead><tr>';
    rows[0].forEach(cell => {
      html += `<th>${cell}</th>`;
    });
    html += '</tr></thead><tbody>';

    for (let i = 2; i < rows.length; i++) {
      html += '<tr>';
      rows[i].forEach(cell => {
        html += `<td>${cell}</td>`;
      });
      html += '</tr>';
    }
  } else {
    html += '<tbody>';
    rows.forEach(row => {
      html += '<tr>';
      row.forEach(cell => {
        html += `<td>${cell}</td>`;
      });
      html += '</tr>';
    });
  }

  html += '</tbody></table>';
  return html;
}

function processNestedLists(html) {
  const lines = html.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    
    const taskMatch = line.match(/^(\s*)- \[([ x])\] (.*)$/);
    if (taskMatch) {
      const listBlock = extractListBlock(lines, i, 'task');
      result.push(buildNestedList(listBlock, 'task'));
      i += listBlock.length;
      continue;
    }

    const ulMatch = line.match(/^(\s*)- (.*)$/);
    if (ulMatch) {
      const listBlock = extractListBlock(lines, i, 'ul');
      result.push(buildNestedList(listBlock, 'ul'));
      i += listBlock.length;
      continue;
    }

    const olMatch = line.match(/^(\s*)\d+\. (.*)$/);
    if (olMatch) {
      const listBlock = extractListBlock(lines, i, 'ol');
      result.push(buildNestedList(listBlock, 'ol'));
      i += listBlock.length;
      continue;
    }

    result.push(line);
    i++;
  }

  return result.join('\n');
}

function extractListBlock(lines, startIndex, type) {
  const block = [];
  let regex;
  
  if (type === 'task') {
    regex = /^(\s*)- \[([ x])\] (.*)$/;
  } else if (type === 'ul') {
    regex = /^(\s*)- (.*)$/;
  } else {
    regex = /^(\s*)\d+\. (.*)$/;
  }

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (regex.test(line)) {
      block.push(line);
    } else if (line.trim() === '') {
      break;
    } else {
      break;
    }
  }

  return block;
}

function buildNestedList(lines, type) {
  if (lines.length === 0) return '';

  const items = lines.map(line => {
    let match;
    if (type === 'task') {
      match = line.match(/^(\s*)- \[([ x])\] (.*)$/);
      return {
        indent: match[1].length,
        checked: match[2] === 'x',
        text: match[3]
      };
    } else if (type === 'ul') {
      match = line.match(/^(\s*)- (.*)$/);
      return {
        indent: match[1].length,
        text: match[2]
      };
    } else {
      match = line.match(/^(\s*)\d+\. (.*)$/);
      return {
        indent: match[1].length,
        text: match[2]
      };
    }
  });

  const listTag = type === 'task' ? 'ul' : type;
  const listClass = type === 'task' ? ' class="task-list"' : '';

  function buildTree(items, currentIndent = 0) {
    let html = `<${listTag}${currentIndent === 0 ? listClass : ''}>`;
    let i = 0;

    while (i < items.length) {
      const item = items[i];

      if (item.indent < currentIndent) {
        break;
      }

      if (item.indent === currentIndent) {
        if (type === 'task') {
          html += `<li class="${item.checked ? 'done' : ''}">`;
          html += `<svg class="task-icon" width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>${item.checked ? '<path d="M4.5 8L7 10.5L11.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' : ''}</svg>`;
          html += item.text;
        } else {
          html += `<li>${item.text}`;
        }

        if (i + 1 < items.length && items[i + 1].indent > currentIndent) {
          const nestedItems = [];
          let j = i + 1;
          while (j < items.length && items[j].indent > currentIndent) {
            nestedItems.push(items[j]);
            j++;
          }
          html += buildTree(nestedItems, currentIndent + 2);
          i = j;
        } else {
          i++;
        }

        html += '</li>';
      } else {
        i++;
      }
    }

    html += `</${listTag}>`;
    return html;
  }

  return buildTree(items);
}

function findRelatedNotes(note, allNotes) {
  const related = [];
  
  allNotes.forEach(other => {
    if (other.id === note.id) return;
    const regex = new RegExp(`\\[\\[${note.title}\\]\\]`);
    if (regex.test(other.content)) {
      related.push(other);
    }
  });
  
  return related;
}

function buildSite() {
  console.log('🏗️  Building static site...');
  
  if (!fs.existsSync('data/notes.json')) {
    console.log('⚠️  No notes.json found. Skipping build.');
    return;
  }
  
  const notes = JSON.parse(fs.readFileSync('data/notes.json', 'utf-8'));
  
  if (notes.length === 0) {
    console.log('⚠️  No published notes found. Skipping build.');
    return;
  }
  
  if (!fs.existsSync('public')) {
    fs.mkdirSync('public');
  }
  
  notes.forEach(note => {
    const relatedNotes = findRelatedNotes(note, notes);
    
    const createdDate = new Date(note.metadata.created).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const updatedDate = new Date(note.metadata.updated).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${note.title}</title>
  <style>
    body {
      max-width: 800px;
      margin: 40px auto;
      padding: 0 20px;
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1.6;
      color: #374151;
    }
    a { 
      color: #4f46e5; 
      text-decoration: none; 
    }
    a:hover { 
      text-decoration: underline; 
    }
    .wiki-link {
      color: #7c3aed;
      font-weight: 500;
    }
    h1 { 
      border-bottom: 2px solid #e5e7eb; 
      padding-bottom: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .meta {
      display: flex;
      gap: 1.5rem;
      color: #6b7280;
      font-size: 0.875rem;
      margin-bottom: 2rem;
    }
    .meta-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .meta-item svg {
      width: 16px;
      height: 16px;
      opacity: 0.7;
    }
    h2 { 
      margin-top: 2rem;
      color: #1f2937;
    }
    blockquote {
      border-left: 4px solid #d1d5db;
      padding-left: 1rem;
      margin: 1.5rem 0;
      color: #6b7280;
      background: #f9fafb;
      padding: 1rem;
      border-radius: 0 4px 4px 0;
    }
    code {
      background: #f3f4f6;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
    }
    pre {
      background: #1f2937;
      color: #e5e7eb;
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
      margin: 1.5rem 0;
    }
    pre code {
      background: none;
      color: inherit;
      padding: 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1.5rem 0;
    }
    th, td {
      border: 1px solid #e5e7eb;
      padding: 0.5rem 1rem;
      text-align: left;
    }
    th {
      background: #f9fafb;
      font-weight: 600;
    }
    ul, ol {
      margin: 1rem 0;
      padding-left: 2rem;
    }
    ul ul, ol ol, ul ol, ol ul {
      margin: 0.5rem 0;
    }
    .task-list {
      list-style: none;
      padding-left: 0;
    }
    .task-list li {
      margin: 0.5rem 0;
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
    }
    .task-icon {
      flex-shrink: 0;
      margin-top: 0.25rem;
    }
    .task-list li.done {
      color: #9ca3af;
    }
    hr {
      border: none;
      border-top: 1px solid #e5e7eb;
      margin: 2rem 0;
    }
    .related { 
      margin-top: 3rem; 
      padding-top: 1.5rem; 
      border-top: 1px solid #e5e7eb; 
    }
    .related h2 { 
      font-size: 1.1rem; 
      color: #6b7280;
      margin-top: 0;
    }
    .related ul {
      list-style: none;
      padding: 0;
    }
    .related li {
      margin: 0.5rem 0;
    }
  </style>
</head>
<body>
  <h1>${note.title}</h1>
  <div class="meta">
    <div class="meta-item">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
        <rect x="3" y="4" width="10" height="9" rx="1" stroke-width="1.5"/>
        <path d="M5 4V2.5M11 4V2.5M3 7H13" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>作成: ${createdDate}</span>
    </div>
    <div class="meta-item">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
        <path d="M8 14A6 6 0 108 2a6 6 0 000 12z" stroke-width="1.5"/>
        <path d="M8 5v3l2 2" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>更新: ${updatedDate}</span>
    </div>
  </div>
  <div class="content">
    ${renderMarkdownToHTML(note.content, notes)}
  </div>
  
  ${relatedNotes.length > 0 ? `
  <div class="related">
    <h2>Related Notes</h2>
    <ul>
      ${relatedNotes.map(r => `<li><a href="${r.id}.html">${r.title}</a></li>`).join('')}
    </ul>
  </div>
  ` : ''}
</body>
</html>`;
    
    fs.writeFileSync(`public/${note.id}.html`, html);
  });
  
  const indexHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Digital Garden</title>
  <style>
    body {
      max-width: 800px;
      margin: 40px auto;
      padding: 0 20px;
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1.6;
    }
    h1 { border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    ul { list-style: none; padding: 0; }
    li { margin: 1rem 0; }
    a { color: #4f46e5; text-decoration: none; font-size: 1.1rem; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>My Digital Garden 🌱</h1>
  <ul>
    ${notes.map(n => `<li><a href="${n.id}.html">${n.title}</a></li>`).join('')}
  </ul>
</body>
</html>`;
  
  fs.writeFileSync('public/index.html', indexHtml);
  
  console.log(`✅ Built ${notes.length} pages`);
}

buildSite();