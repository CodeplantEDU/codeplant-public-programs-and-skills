const $ = (id) => document.getElementById(id);
let chatId = null, currentMessages = [], busy = false;
let configured = false, adminBusy = false, adminConfigured = false, adminDirty = false;
async function api(path, body) {
  let r;
  try {
    r = await fetch(path, {method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? {} : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  } catch {
    throw new Error('서버에 연결할 수 없습니다. 내부망 연결을 확인한 뒤 다시 시도하세요. 입력한 내용은 유지됩니다.');
  }
  let data;
  try { data = await r.json(); } catch { throw new Error('서버 응답을 읽을 수 없습니다. 잠시 후 다시 시도하세요.'); }
  if (!r.ok) {
    const failure = new Error(data.error || '요청을 처리할 수 없습니다. 잠시 후 다시 시도하세요.');
    failure.status = r.status; throw failure;
  }
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
function chatBusy(value, state = '') {
  busy = value;
  $('send').disabled = value || !configured;
  $('send').textContent = value ? (state.includes('분석') ? '분석 중…' : '처리 중…') : '질문 보내기';
  $('new-chat').disabled = value;
  $('question').readOnly = value;
  $('export').disabled = value || !currentMessages.length;
  $('messages').setAttribute('aria-busy', String(value));
  $('chat-state').textContent = state;
  document.querySelectorAll('#history button, [data-prompt]').forEach(b => b.disabled = value);
}
async function refreshHistory() {
  const chats = await api('/api/chats'); $('history').replaceChildren();
  if (!chats.length) $('history').append(element('p', '저장된 대화가 없습니다.', 'muted small'));
  chats.forEach(c => {
    const row = element('div', undefined, 'history-item' + (chatId === c.id ? ' active' : ''));
    const open = element('button', c.title, 'open-chat'); open.title = c.title;
    if (chatId === c.id) open.setAttribute('aria-current', 'true');
    open.disabled = busy; open.onclick = () => loadChat(c.id);
    const del = element('button', undefined, 'delete-chat');
    del.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.5"/></svg>';
    del.setAttribute('aria-label', c.title + ' 대화 삭제'); del.title = '대화 삭제'; del.disabled = busy;
    del.onclick = async () => {
      if (busy || !confirm('이 대화 기록을 삭제할까요? 삭제 후에는 복구할 수 없습니다.')) return;
      chatBusy(true, '대화 삭제 중…');
      try { await api('/api/chats/delete', {chat_id: c.id}); if (chatId === c.id) newChat(); await refreshHistory(); }
      catch (e) { error('chat-error', e.message); }
      finally { chatBusy(false); }
    };
    row.append(open, del); $('history').append(row);
  });
}
async function historySafely() {
  try { await refreshHistory(); }
  catch { error('chat-error', '대화 목록을 불러오지 못했습니다. 입력한 질문과 현재 답변은 유지됩니다.'); }
}
let welcome;
function newChat() {
  chatId = null; currentMessages = []; $('messages').replaceChildren(welcome.cloneNode(true)); bindSuggestions();
  $('export').disabled = true; error('chat-error', ''); $('question').value = ''; $('question').focus();
}
function bindSuggestions() { document.querySelectorAll('[data-prompt]').forEach(b => b.onclick = () => { if (busy) return; $('question').value = b.dataset.prompt; $('question').focus(); }); }
async function loadChat(id) {
  if (busy) return;
  chatBusy(true, '대화 불러오는 중…'); error('chat-error', '');
  try {
    const c = await api('/api/chats/' + id); chatId = id; currentMessages = c.messages; $('messages').replaceChildren();
    c.messages.forEach(m => renderMessage(m.role, m.data)); await historySafely();
  } catch (e) { error('chat-error', e.message); }
  finally { chatBusy(false); }
}
async function refreshStatus() {
  let statusLoaded = false;
  $('retry-connection').hidden = true;
  $('connection').textContent = '설정 확인 중';
  try {
    const s = await api('/api/status'); configured = s.configured; statusLoaded = true;
    $('setup-banner').hidden = configured; $('connection').textContent = configured ? 'API 키 저장됨' : 'API 키 등록 필요';
    $('brand-label').textContent = s.brand || '분석 대상 미설정'; $('model-label').textContent = s.model + ' · ' + (s.web_search ? '웹 검색 사용' : '웹 검색 미사용');
    error('chat-error', '');
  } catch (e) {
    configured = false; $('connection').textContent = '서버 연결 확인 필요'; $('retry-connection').hidden = false; error('chat-error', e.message);
  }
  chatBusy(busy); return statusLoaded;
}
async function chatPage() {
  welcome = $('welcome').cloneNode(true); bindSuggestions();
  $('retry-connection').onclick = async () => { await refreshStatus(); if (configured) await historySafely(); };
  $('new-chat').onclick = async () => { if (busy) return; newChat(); await historySafely(); };
  $('question').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy && configured) $('chat-form').requestSubmit(); } });
  $('chat-form').onsubmit = async e => {
    e.preventDefault(); if (busy || !configured) return;
    const question = $('question').value.trim(); if (!question) return;
    chatBusy(true, '답변 생성 및 GEO 분석 중'); error('chat-error', '');
    if ($('welcome')) $('messages').replaceChildren();
    const user = renderMessage('user', {text: question});
    const pending = element('div', undefined, 'pending'); pending.append(element('span'), document.createTextNode('답변을 생성하고 GEO를 분석하고 있습니다. 최대 몇 분 걸릴 수 있습니다.')); $('messages').append(pending);
    pending.scrollIntoView({block:'end'});
    let succeeded = false;
    try {
      const result = await api('/api/chat', {question, chat_id: chatId}); chatId = result.chat_id;
      pending.remove(); currentMessages.push({role:'user', data:{text:question}}, {role:'assistant', data:result.result});
      const answer = renderMessage('assistant', result.result); $('question').value = ''; succeeded = true;
      answer.scrollIntoView({block:'start'});
    } catch (e) {
      user.remove(); pending.remove();
      if (!currentMessages.length) { $('messages').replaceChildren(welcome.cloneNode(true)); bindSuggestions(); }
      error('chat-error', e.message + ' 입력한 질문을 확인하고 다시 보내세요.');
    } finally {
      chatBusy(false, succeeded ? '답변과 GEO 분석이 저장되었습니다.' : '질문 전송에 실패했습니다.');
      $('question').focus({preventScroll:true}); if (succeeded) await historySafely();
    }
  };
  $('export').onclick = () => {
    const text = currentMessages.map(m => m.role === 'user' ? '## 질문\n' + m.data.text : '## AI 답변\n' + m.data.text + '\n\n## GEO 분석\n' + (m.data.evaluation || m.data.evaluation_error || '추가 분석 없음') + '\n\n## 출처\n' + m.data.sources.map(s => s.title + ': ' + s.url).join('\n')).join('\n\n');
    const url = URL.createObjectURL(new Blob([text], {type:'text/plain;charset=utf-8'})); const a = element('a'); a.href = url; a.download = 'geo-chat-' + new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()) + '.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
    $('chat-state').textContent = '대화 내용을 텍스트 파일로 내보냈습니다.';
  };
  if (await refreshStatus()) await historySafely();
}
async function showSettings() {
  const s = await api('/api/admin/settings'); $('login-panel').hidden = true; $('settings-panel').hidden = false;
  $('model').value = s.model; $('brand').value = s.brand; $('website').value = s.website; $('daily-limit').value = s.daily_limit; $('web-search').checked = s.web_search;
  adminConfigured = s.configured;
  $('key-state').textContent = s.configured ? '저장됨 ' + s.key_hint : '미등록'; $('api-key').value = ''; $('test-result').textContent = s.key_tested ? '키 인증·모델 목록 접근 확인 완료' : '';
  adminDirty = false; $('save-result').textContent = '변경한 설정이 없습니다.'; updateAdminActions();
}
function updateAdminActions() { $('delete-key').disabled = adminBusy || !adminConfigured; $('test-key').disabled = adminBusy || !adminConfigured; }
async function adminAction(action) {
  if (adminBusy) return;
  adminBusy = true; error('admin-error','');
  const controls = [...document.querySelectorAll('.admin-main button, .admin-main input')];
  const previous = controls.map(el => el.disabled); controls.forEach(el => el.disabled = true);
  $('settings-panel').setAttribute('aria-busy','true'); $('login-form').setAttribute('aria-busy','true');
  try { await action(); }
  catch (e) {
    if (e.status === 401) { $('settings-panel').hidden = true; $('login-panel').hidden = false; }
    error('admin-error', e.message); $('admin-error').scrollIntoView({block:'nearest'});
  } finally {
    controls.forEach((el,i) => el.disabled = previous[i]); adminBusy = false; updateAdminActions();
    $('settings-panel').setAttribute('aria-busy','false'); $('login-form').setAttribute('aria-busy','false');
  }
}
async function adminPage() {
  $('settings-form').addEventListener('input', () => { adminDirty = true; $('save-result').textContent='저장하지 않은 변경사항이 있습니다.'; $('test-result').textContent='연결 확인은 저장된 설정을 사용합니다. 변경사항을 먼저 저장하세요.'; });
  window.addEventListener('beforeunload', e => { if (adminDirty) { e.preventDefault(); e.returnValue=''; } });
  $('login-form').onsubmit = e => {
    e.preventDefault(); const button=e.target.querySelector('button');
    adminAction(async () => { button.textContent='로그인 중…'; try { await api('/api/admin/login',{username:$('username').value, password:$('password').value}); $('password').value=''; await showSettings(); } finally { button.textContent='로그인'; } });
  };
  $('settings-form').onsubmit = e => {
    e.preventDefault();
    adminAction(async () => {
      $('save-result').textContent='저장 중…';
      try {
        await api('/api/admin/settings',{api_key:$('api-key').value, model:$('model').value.trim(), brand:$('brand').value.trim(), website:$('website').value.trim(), web_search:$('web-search').checked, daily_limit:Number($('daily-limit').value)});
        await showSettings(); $('save-result').textContent='설정이 저장되었습니다. 질문 페이지에서 사용할 수 있습니다.';
      } catch (e) { $('save-result').textContent='저장하지 못했습니다. 입력한 내용은 유지됩니다.'; throw e; }
    });
  };
  $('test-key').onclick = () => adminAction(async () => {
    if (adminDirty) { $('test-result').textContent='변경사항을 먼저 저장한 뒤 연결을 확인하세요.'; return; }
    $('test-result').textContent='저장된 키 연결 확인 중…';
    try { const r=await api('/api/admin/test',{}); $('test-result').textContent=r.message; }
    catch (e) { $('test-result').textContent='연결 확인에 실패했습니다. 저장된 설정을 확인하세요.'; throw e; }
  });
  $('delete-key').onclick = () => {
    if (adminBusy || !confirm('저장된 API 키를 삭제할까요? 새 키를 등록하기 전까지 질문을 보낼 수 없습니다.' + (adminDirty ? ' 저장하지 않은 설정 변경도 취소됩니다.' : ''))) return;
    adminAction(async () => { await api('/api/admin/delete-key',{}); await showSettings(); $('save-result').textContent='저장된 API 키를 삭제했습니다.'; });
  };
  $('logout').onclick = () => {
    if (adminDirty && !confirm('저장하지 않은 변경사항이 있습니다. 로그아웃할까요?')) return;
    adminAction(async () => { await api('/api/admin/logout',{}); adminDirty=false; location.reload(); });
  };
  $('confirm-password').addEventListener('input', () => $('confirm-password').setCustomValidity(''));
  $('new-password').addEventListener('input', () => $('confirm-password').setCustomValidity(''));
  $('password-form').onsubmit = e => {
    e.preventDefault();
    if ($('new-password').value !== $('confirm-password').value) { $('confirm-password').setCustomValidity('새 비밀번호가 일치하지 않습니다.'); $('confirm-password').reportValidity(); return; }
    if (adminDirty && !confirm('비밀번호 변경 후 다시 로그인합니다. 저장하지 않은 설정을 취소하고 계속할까요?')) return;
    adminAction(async () => { await api('/api/admin/password',{old_password:$('old-password').value,new_password:$('new-password').value}); adminDirty=false; location.reload(); });
  };
  try { await showSettings(); }
  catch (e) { if (e.status !== 401) error('admin-error', e.message); }
}
(document.body.dataset.page === 'admin' ? adminPage() : chatPage()).catch(e => error(document.body.dataset.page === 'admin' ? 'admin-error' : 'chat-error',e.message));
