/* app.js — общий слой для всех страниц:
   1) состояние кнопки входа в навигации,
   2) AI-чатбот, встроенный в каждую страницу и связанный с backend (/api/chat). */
(function () {
  'use strict';

  // ---------- АВТОРИЗАЦИЯ В ШАПКЕ ----------
  function setupAuthButtons() {
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username') || 'Кабинет';
    document.querySelectorAll('.auth-nav-btn').forEach((btn) => {
      btn.style.pointerEvents = 'auto';
      btn.style.cursor = 'pointer';
      btn.onclick = () => (window.location.href = token ? 'profile.html' : 'entrance.html');
      btn.textContent = token ? '👤 ' + username : 'Войти';
      btn.classList.toggle('auth-nav-btn--logged', !!token);
    });
    // Кнопки .login-btn на страницах-направлениях/достопримечательностях
    // (содержат иконку — не затираем разметку, меняем только поведение и подпись текста).
    document.querySelectorAll('.login-btn').forEach((btn) => {
      btn.style.cursor = 'pointer';
      btn.onclick = () => (window.location.href = token ? 'profile.html' : 'entrance.html');
      if (token) {
        btn.title = username;
        // Обновляем только текстовый узел, сохраняя SVG-иконку
        let replaced = false;
        btn.childNodes.forEach((n) => {
          if (n.nodeType === 3 && n.textContent.trim()) { n.textContent = ' ' + username; replaced = true; }
        });
        if (!replaced) btn.appendChild(document.createTextNode(' ' + username));
      }
    });
  }

  // ---------- ССЫЛКА «АДМИН» В НАВИГАЦИИ (только для администратора) ----------
  async function injectAdminLink() {
    const token = localStorage.getItem('token');
    if (!token) return;
    let role = localStorage.getItem('role');
    if (!role) {
      // Узнаём роль один раз и кэшируем
      try {
        const res = await fetch('/api/profile', { headers: { Authorization: 'Bearer ' + token } });
        if (res.ok) {
          const data = await res.json();
          role = data.user && data.user.role;
          if (role) localStorage.setItem('role', role);
        }
      } catch (e) { /* офлайн — пропускаем */ }
    }
    if (role !== 'admin') return;
    document.querySelectorAll('.main-nav').forEach((nav) => {
      if (nav.querySelector('.admin-nav-link')) return;
      const a = document.createElement('a');
      a.href = 'admin.html';
      a.className = 'nav-link admin-nav-link';
      a.textContent = '⚙ Админ';
      const authBtn = nav.querySelector('.auth-nav-btn');
      if (authBtn) nav.insertBefore(a, authBtn); else nav.appendChild(a);
    });
    // в мобильное меню тоже
    const ml = document.querySelector('#stMobileLinks');
    if (ml && !ml.querySelector('.admin-nav-link')) {
      const a = document.createElement('a');
      a.href = 'admin.html'; a.className = 'admin-nav-link'; a.textContent = '⚙ Админ-панель';
      ml.appendChild(a);
    }
  }

  // ---------- МОБИЛЬНОЕ МЕНЮ (гамбургер) ----------
  function buildMobileNav() {
    const header = document.querySelector('.site-header .header-container');
    const nav = header && header.querySelector('.main-nav');
    if (!header || !nav || document.getElementById('stBurger')) return;

    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username') || 'Войти';

    // Кнопка-гамбургер в шапке
    const burger = document.createElement('button');
    burger.id = 'stBurger';
    burger.className = 'st-burger';
    burger.setAttribute('aria-label', 'Открыть меню');
    burger.innerHTML = '<span></span><span></span><span></span>';
    header.appendChild(burger);

    // Выдвижная панель
    const drawer = document.createElement('div');
    drawer.id = 'stDrawer';
    drawer.className = 'st-drawer';
    const links = Array.from(nav.querySelectorAll('a.nav-link'))
      .map((a) => `<a href="${a.getAttribute('href')}">${a.textContent.trim()}</a>`).join('');
    drawer.innerHTML = `
      <div class="st-drawer-panel" role="dialog" aria-label="Меню">
        <div class="st-drawer-head">
          <span class="st-drawer-logo">Свой турист</span>
          <button class="st-drawer-close" aria-label="Закрыть">×</button>
        </div>
        <nav class="st-drawer-links" id="stMobileLinks">
          ${links}
          <a href="${token ? 'profile.html' : 'entrance.html'}" class="st-drawer-cta">${token ? '👤 ' + username : 'Войти'}</a>
        </nav>
      </div>`;
    document.body.appendChild(drawer);

    const close = () => { drawer.classList.remove('open'); document.body.style.overflow = ''; };
    const open = () => { drawer.classList.add('open'); document.body.style.overflow = 'hidden'; };
    burger.addEventListener('click', open);
    drawer.querySelector('.st-drawer-close').addEventListener('click', close);
    drawer.addEventListener('click', (e) => { if (e.target === drawer) close(); });
  }

  // ---------- ЧАТБОТ ----------
  function currentPage() {
    const p = (location.pathname.split('/').pop() || 'index.html').replace('.html', '');
    return p || 'index';
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function buildChat() {
    if (document.getElementById('stChatWrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'stChatWrap';
    wrap.className = 'st-chat-wrap';
    wrap.innerHTML = `
      <button class="st-chat-toggle" id="stChatToggle" aria-label="Открыть чат с помощником">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM7 9h10v2H7V9zm6 5H7v-2h6v2zm4-6H7V6h10v2z"/></svg>
        <span class="st-chat-badge">AI</span>
      </button>
      <div class="st-chat-window" id="stChatWindow" role="dialog" aria-label="AI-помощник">
        <div class="st-chat-header">
          <div class="st-chat-ava">AI</div>
          <div class="st-chat-head-info">
            <strong>Помощник по подбору</strong>
            <span>Онлайн • подберу отель и помогу с бронью</span>
          </div>
          <button class="st-chat-close" id="stChatClose" aria-label="Закрыть">×</button>
        </div>
        <div class="st-chat-body" id="stChatBody"></div>
        <div class="st-chat-quick" id="stChatQuick">
          <button data-q="Подбери отель у моря">🏖 Отель у моря</button>
          <button data-q="Отель до 12000">💰 До 12 000 ₽</button>
          <button data-q="Статус моей брони">📋 Статус брони</button>
          <button data-q="Как забронировать?">❓ Как забронировать</button>
        </div>
        <form class="st-chat-form" id="stChatForm">
          <input type="text" id="stChatInput" placeholder="Напишите вопрос…" autocomplete="off" />
          <button type="submit" aria-label="Отправить">➤</button>
        </form>
      </div>`;
    document.body.appendChild(wrap);

    const toggle = wrap.querySelector('#stChatToggle');
    const win = wrap.querySelector('#stChatWindow');
    const closeBtn = wrap.querySelector('#stChatClose');
    const body = wrap.querySelector('#stChatBody');
    const form = wrap.querySelector('#stChatForm');
    const input = wrap.querySelector('#stChatInput');

    function open() { win.classList.add('active'); setTimeout(() => input.focus(), 50); }
    function close() { win.classList.remove('active'); }

    toggle.addEventListener('click', () => (win.classList.contains('active') ? close() : open()));
    closeBtn.addEventListener('click', close);

    function addMsg(html, who) {
      const m = document.createElement('div');
      m.className = 'st-chat-msg st-chat-msg-' + who;
      m.innerHTML = `<div class="st-chat-bubble">${html}</div>`;
      body.appendChild(m);
      body.scrollTop = body.scrollHeight;
      return m;
    }

    function renderReply(data) {
      let html = escapeHtml(data.reply).replace(/\n/g, '<br>');
      if (Array.isArray(data.suggestions) && data.suggestions.length) {
        html += '<div class="st-chat-cards">' + data.suggestions.map((s) =>
          `<a class="st-chat-card" href="${escapeHtml(s.href)}"><strong>${escapeHtml(s.title)}</strong><span>${escapeHtml(s.subtitle || '')}</span></a>`
        ).join('') + '</div>';
      }
      if (Array.isArray(data.actions) && data.actions.length) {
        html += '<div class="st-chat-actions">' + data.actions.map((a) =>
          `<a class="st-chat-action" href="${escapeHtml(a.href)}">${escapeHtml(a.label)}</a>`
        ).join('') + '</div>';
      }
      addMsg(html, 'bot');
    }

    function typing(on) {
      let t = body.querySelector('#stTyping');
      if (on && !t) {
        t = document.createElement('div');
        t.id = 'stTyping';
        t.className = 'st-chat-msg st-chat-msg-bot';
        t.innerHTML = '<div class="st-chat-bubble"><span class="st-dot"></span><span class="st-dot"></span><span class="st-dot"></span></div>';
        body.appendChild(t);
        body.scrollTop = body.scrollHeight;
      } else if (!on && t) t.remove();
    }

    async function send(text) {
      addMsg(escapeHtml(text), 'user');
      typing(true);
      try {
        const token = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers,
          body: JSON.stringify({ message: text, page: currentPage() }),
        });
        const data = await res.json();
        typing(false);
        if (!res.ok) { addMsg(escapeHtml(data.error || 'Не удалось получить ответ.'), 'bot'); return; }
        renderReply(data);
      } catch (e) {
        typing(false);
        addMsg('Сервер недоступен. Попробуйте позже.', 'bot');
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      input.value = '';
      send(v);
    });

    wrap.querySelectorAll('#stChatQuick button').forEach((b) =>
      b.addEventListener('click', () => send(b.dataset.q))
    );

    // приветствие
    addMsg('Здравствуйте! Я помогу подобрать отель, рассчитать стоимость и оформить бронирование. С чего начнём?', 'bot');
  }

  document.addEventListener('DOMContentLoaded', function () {
    setupAuthButtons();
    buildMobileNav();
    injectAdminLink();
    buildChat();
  });
})();