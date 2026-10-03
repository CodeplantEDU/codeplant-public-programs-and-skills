const $ = (id) => document.getElementById(id);
let chatId = null, currentMessages = [], busy = false;
async function api(path, body) {
  const r = await fetch(path, {method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? {} : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || '요청을 처리할 수 없습니다.');
  return data;
}
function error(id, value) { $(id).hidden = !value; $(id).textContent = value || ''; }
function element(tag, text, cls) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; }
function safeLink(url, title) {
  try { const u = new URL(url); if (!['https:', 'http:'].includes(u.protocol)) return element('span', title); } catch { return element('span', title); }
  const a = element('a', title); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
}
function answerText(data) {
  const div = element('div', undefined, 'answer-text');
  let cursor = 0;
  const annotations = [...(data.annotations || [])].sort((a, b) => a.start - b.start);
  for (const a of annotations) {
    if (a.start < cursor || a.start < 0 || a.end > data.text.length || a.end <= a.start) continue;
    div.append(document.createTextNode(data.text.slice(cursor, a.start)));
    div.append(safeLink(a.url, data.text.slice(a.start, a.end) || a.title)); cursor = a.end;
  }
  div.append(document.createTextNode(data.text.slice(cursor)));
  return div;
}
function renderMessage(role, data) {
  const article = element('article', undefined, 'message ' + role);
  article.append(element('div', role === 'user' ? '나의 질문' : 'GEO Desk · ' + data.model, 'message-label'));
  if (role === 'user') article.append(element('div', data.text, 'message-content'));
  else {
    article.append(answerText(data));
    const metrics = element('div', undefined, 'metrics');
    for (const [label, value] of [['브랜드 언급', data.mentions === null ? '미설정' : data.mentions + '회'], ['공식 사이트 인용', data.website ? data.brand_citations + '개' : '미설정'], ['인용 출처', data.sources.length + '개']]) {
      const item = element('span', label); item.append(element('strong', value)); metrics.append(item);
    }
    article.append(metrics);
    article.append(element('p', (data.brand ? '분석 대상: ' + data.brand : '브랜드가 설정되지 않았습니다.') + ' · ' + (data.search ? '웹 검색 사용' : '웹 검색 미사용'), 'help'));
    if (data.sources.length) {
      const details = element('details', undefined, 'sources'); details.append(element('summary', '인용 출처 보기'));
      const list = element('ol', undefined, 'source-list');
      data.sources.forEach(s => { const li = element('li'); li.append(safeLink(s.url, s.title)); list.append(li); }); details.append(list); article.append(details);
    }
    const analysis = element('details', undefined, 'analysis'); analysis.open = true;
    analysis.append(element('summary', 'GEO 관측 및 개선안'));
    analysis.append(element('div', data.evaluation || ('추가 분석에 실패했습니다. 답변은 저장되었습니다. ' + (data.evaluation_error || '')), 'analysis-content'));
    article.append(analysis);
  }
  $('messages').append(article); return article;
}
async function refreshHistory() {
  const chats = await api('/api/chats'); $('history').replaceChildren();
  if (!chats.length) $('history').append(element('p', '저장된 대화가 없습니다.', 'muted small'));
  chats.forEach(c => {
    const row = element('div', undefined, 'history-item' + (chatId === c.id ? ' active' : ''));
    const open = element('button', c.title, 'open-chat'); open.title = c.title;
    open.disabled = busy; open.onclick = () => loadChat(c.id).catch(e => error('chat-error', e.message));
    const del = element('button', '×', 'delete-chat'); del.setAttribute('aria-label', c.title + ' 대화 삭제'); del.disabled = busy;
    del.onclick = async () => { if (!confirm('이 대화 기록을 삭제할까요?')) return; try { await api('/api/chats/delete', {chat_id: c.id}); if (chatId === c.id) newChat(); await refreshHistory(); } catch (e) { error('chat-error', e.message); } };
    row.append(open, del); $('history').append(row);
  });
}
function newChat() { chatId = null; currentMessages = []; $('messages').replaceChildren(welcome.cloneNode(true)); bindSuggestions(); $('export').disabled = true; error('chat-error', ''); $('question').value = ''; }
let welcome;
function bindSuggestions() { document.querySelectorAll('[data-prompt]').forEach(b => b.onclick = () => { $('question').value = b.dataset.prompt; $('question').focus(); }); }
async function loadChat(id) {
  if (busy) return;
  const c = await api('/api/chats/' + id); chatId = id; currentMessages = c.messages; $('messages').replaceChildren();
  c.messages.forEach(m => renderMessage(m.role, m.data)); $('export').disabled = false; error('chat-error', ''); await refreshHistory();
}
async function chatPage() {
  welcome = $('welcome').cloneNode(true); bindSuggestions();
  const s = await api('/api/status'); $('setup-banner').hidden = s.configured; $('connection').textContent = s.configured ? 'API 키 저장됨' : 'API 연결 필요';
  $('brand-label').textContent = s.brand || '분석 대상 미설정'; $('model-label').textContent = s.model + ' · ' + (s.web_search ? '웹 검색 사용' : '웹 검색 미사용');
  $('send').disabled = !s.configured; await refreshHistory();
  $('new-chat').onclick = async () => { if (busy) return; newChat(); await refreshHistory(); };
  $('question').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy && !$('send').disabled) $('chat-form').requestSubmit(); } });
  $('chat-form').onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    const question = $('question').value.trim(); if (!question) return;
    busy = true; $('send').disabled = true; $('new-chat').disabled = true; $('send').textContent = '분석 중…'; error('chat-error', '');
    if ($('welcome')) $('messages').replaceChildren();
    const user = renderMessage('user', {text: question});
    const pending = element('div', undefined, 'pending'); pending.append(element('span'), document.createTextNode('답변을 생성하고 GEO를 분석하고 있습니다. 최대 몇 분 걸릴 수 있습니다.')); $('messages').append(pending);
    pending.scrollIntoView({block:'end'});
    try {
      const result = await api('/api/chat', {question, chat_id: chatId}); chatId = result.chat_id;
      pending.remove(); currentMessages.push({role:'user', data:{text:question}}, {role:'assistant', data:result.result});
      renderMessage('assistant', result.result); $('question').value = ''; $('export').disabled = false;
    } catch (e) { user.remove(); pending.remove(); error('chat-error', e.message); }
    finally { busy = false; $('send').disabled = false; $('new-chat').disabled = false; $('send').textContent = '질문 보내기'; await refreshHistory(); }
  };
  $('export').onclick = () => {
    const text = currentMessages.map(m => m.role === 'user' ? '## 질문\n' + m.data.text : '## AI 답변\n' + m.data.text + '\n\n## GEO 분석\n' + m.data.evaluation + '\n\n## 출처\n' + m.data.sources.map(s => s.title + ': ' + s.url).join('\n')).join('\n\n');
    const url = URL.createObjectURL(new Blob([text], {type:'text/plain;charset=utf-8'})); const a = element('a'); a.href = url; a.download = 'geo-chat-' + new Date().toISOString().slice(0,10) + '.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  };
}
async function showSettings() {
  const s = await api('/api/admin/settings'); $('login-panel').hidden = true; $('settings-panel').hidden = false;
  $('model').value = s.model; $('brand').value = s.brand; $('website').value = s.website; $('daily-limit').value = s.daily_limit; $('web-search').checked = s.web_search;
  $('key-state').textContent = s.configured ? '저장됨 ' + s.key_hint : '미등록'; $('api-key').value = ''; $('test-result').textContent = s.key_tested ? '키 인증·모델 목록 접근 확인 완료' : ''; $('delete-key').disabled = !s.configured;
}
function submitting(form, value) { form.querySelectorAll('button').forEach(b => b.disabled = value); }
async function adminPage() {
  try { await showSettings(); } catch { /* Expected before login. */ }
  $('login-form').onsubmit = async e => { e.preventDefault(); error('admin-error',''); submitting(e.target,true); try { await api('/api/admin/login',{username:$('username').value, password:$('password').value}); $('password').value = ''; await showSettings(); } catch(e) { error('admin-error',e.message); } finally { submitting($('login-form'),false); } };
  $('settings-form').onsubmit = async e => { e.preventDefault(); error('admin-error',''); $('save-result').textContent='저장 중…'; submitting(e.target,true); try { await api('/api/admin/settings',{api_key:$('api-key').value, model:$('model').value.trim(), brand:$('brand').value.trim(), website:$('website').value.trim(), web_search:$('web-search').checked, daily_limit:Number($('daily-limit').value)}); await showSettings(); $('save-result').textContent='설정이 저장되었습니다.'; } catch(e) { $('save-result').textContent=''; error('admin-error',e.message); } finally { submitting($('settings-form'),false); $('delete-key').disabled = $('key-state').textContent === '미등록'; } };
  $('test-key').onclick = async () => { error('admin-error',''); $('test-key').disabled=true; $('test-result').textContent='연결 확인 중…'; try { const r = await api('/api/admin/test',{}); $('test-result').textContent=r.message; } catch(e) { $('test-result').textContent=''; error('admin-error',e.message); } finally { $('test-key').disabled=false; } };
  $('delete-key').onclick = async () => { if (!confirm('저장된 API 키를 삭제할까요? 채팅 요청이 중단됩니다.')) return; try { await api('/api/admin/delete-key',{}); await showSettings(); } catch(e) { error('admin-error',e.message); } };
  $('logout').onclick = async () => { try { await api('/api/admin/logout',{}); location.reload(); } catch(e) { error('admin-error',e.message); } };
  $('password-form').onsubmit = async e => { e.preventDefault(); error('admin-error',''); submitting(e.target,true); try { await api('/api/admin/password',{old_password:$('old-password').value,new_password:$('new-password').value}); location.reload(); } catch(e) { error('admin-error',e.message); } finally { submitting($('password-form'),false); } };
}
(document.body.dataset.page === 'admin' ? adminPage() : chatPage()).catch(e => error(document.body.dataset.page === 'admin' ? 'admin-error' : 'chat-error',e.message));
