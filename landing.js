/* landing.js — оживляет статические страницы-направления (PhuQuoc.html, Thailand.html …):
   - подставляет реальные отели направления из БД вместо захардкоженных карточек,
   - делает кнопки «Просмотр» / «Полное описание» рабочими (→ карточка отеля),
   - убирает тупиковые переходы: поиск и «Показать ещё» ведут в каталог с фильтром.
   Страница задаёт направление через window.ST_LANDING = { destination: 'Фукуок' }. */
(function () {
  'use strict';
  const cfg = window.ST_LANDING || {};
  const DEST = cfg.destination || '';
  const RU = (n) => Number(n || 0).toLocaleString('ru-RU');

  function searchUrl() {
    return 'search-results.html' + (DEST ? '?destination=' + encodeURIComponent(DEST) : '');
  }

  function cardHTML(h) {
    const desc = (h.description || '').slice(0, 160) + ((h.description || '').length > 160 ? '…' : '');
    return `
      <div class="hotel-card" style="cursor:pointer;" onclick="location.href='hotel-detail.html?slug=${encodeURIComponent(h.slug)}'">
        <div class="hotel-image" style="background-image:url('${h.image || ''}');background-size:cover;background-position:center;"></div>
        <div class="hotel-content">
          <div class="hotel-header">
            <div><h3 class="hotel-title">${h.name}</h3></div>
            <div class="hotel-rating">${Number(h.star_rating).toFixed(1)}</div>
          </div>
          <p class="hotel-description">${desc}</p>
          <div class="hotel-footer">
            <span style="font-weight:700;color:#2c7269;">от ${RU(h.base_price)} ₽/ночь</span>
            <button class="hotel-view-btn" type="button"
              onclick="event.stopPropagation();location.href='hotel-detail.html?slug=${encodeURIComponent(h.slug)}'">Выбрать даты →</button>
          </div>
        </div>
      </div>`;
  }

  function wireDeadEnds() {
    // «Показать ещё» и «Фильтры» — в каталог с фильтром по направлению
    document.querySelectorAll('.show-more-btn, .filter-btn').forEach((b) => {
      b.addEventListener('click', (e) => { e.preventDefault(); location.href = searchUrl(); });
    });
    // «Готово» в пикере дат/гостей — тоже ведёт к подбору отелей
    if (typeof window.applyFilters === 'function') {
      const orig = window.applyFilters;
      window.applyFilters = function () { try { orig(); } catch (e) {} location.href = searchUrl(); };
    }
    // мёртвые «Полное описание»
    document.querySelectorAll('a.hotel-link[href="#"]').forEach((a) => a.setAttribute('href', searchUrl()));
  }

  async function loadHotels() {
    const section = document.querySelector('.hotels-section .container');
    if (!section || !DEST) { wireDeadEnds(); return; }
    let hotels = [];
    try {
      const res = await fetch('/api/hotels?destination=' + encodeURIComponent(DEST));
      const data = await res.json();
      hotels = data.hotels || [];
    } catch (e) { wireDeadEnds(); return; }
    if (!hotels.length) { wireDeadEnds(); return; }

    // удаляем старые статические карточки и обёртку «Показать ещё»
    section.querySelectorAll('.hotel-card').forEach((c) => c.remove());
    const showMore = section.querySelector('.show-more-wrapper');

    const frag = document.createElement('div');
    frag.innerHTML = hotels.map(cardHTML).join('');
    const header = section.querySelector('.section-header');
    while (frag.firstChild) {
      const node = frag.firstChild;
      if (showMore) section.insertBefore(node, showMore);
      else if (header) header.insertAdjacentElement('afterend', node);
      else section.appendChild(node);
    }
    if (showMore) {
      const btn = showMore.querySelector('.show-more-btn');
      if (btn) btn.textContent = 'Смотреть все отели в каталоге';
    }
    wireDeadEnds();
  }

  document.addEventListener('DOMContentLoaded', loadHotels);
})();
