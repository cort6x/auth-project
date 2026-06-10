'use strict';

/**
 * Движок ответов AI-чатбота.
 *
 * Не зависит от express/sqlite: на вход получает уже готовые данные
 * (список отелей, брони пользователя, контекст страницы) и возвращает
 * структурированный ответ { reply, suggestions, actions }.
 *
 * Это даёт «реальную пользу»: бот отвечает на основе данных сайта,
 * подбирает отели по бюджету/направлению, подсказывает статус брони
 * и направляет на нужные страницы.
 */

function fmt(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
}

// Достаём число-бюджет из фразы: "до 15000", "15 000 руб", "бюджет 20000"
function extractBudget(text) {
  const cleaned = text.replace(/\s/g, '');
  const m = cleaned.match(/(\d{4,7})/);
  return m ? Number(m[1]) : null;
}

function extractGuests(text) {
  const m = text.match(/(\d+)\s*(человек|гост|взросл|чел)/);
  return m ? Number(m[1]) : null;
}

function hotelLink(h) {
  return `hotel-detail.html?slug=${encodeURIComponent(h.slug)}`;
}

function listHotels(hotels, limit = 3) {
  return hotels.slice(0, limit).map((h) => ({
    type: 'hotel',
    title: h.name,
    subtitle: `${h.destination} · ★ ${Number(h.star_rating).toFixed(1)} · от ${fmt(h.base_price)} ₽/ночь`,
    href: hotelLink(h),
  }));
}

/**
 * @param {string} message      текст пользователя
 * @param {Object} ctx
 *   - hotels:   Array отелей из БД
 *   - bookings: Array броней пользователя (может быть пустым/undefined)
 *   - user:     { username } | null
 *   - page:     строка вроде 'hotel-detail' | 'payment' | 'index' ...
 */
function generateReply(message, ctx = {}) {
  const hotels = Array.isArray(ctx.hotels) ? ctx.hotels : [];
  const bookings = Array.isArray(ctx.bookings) ? ctx.bookings : [];
  const user = ctx.user || null;
  const page = ctx.page || '';
  const t = norm(message);

  const actions = [];
  let suggestions = [];

  // 1. Приветствие
  if (/^(привет|здравств|хай|hello|hi|добр|начать|старт)/.test(t)) {
    const name = user && user.username ? `, ${user.username}` : '';
    return {
      reply: `Здравствуйте${name}! Я помогу подобрать отель, рассчитать стоимость и оформить бронирование. Скажите направление и бюджет — например: «отель в Пунта-Кана до 15000» — или спросите про статус брони.`,
      suggestions,
      actions: [{ label: 'Смотреть все отели', href: 'hotels.html' }],
    };
  }

  // 2. Статус брони / мои бронирования
  if (/(статус|мои брон|мое брон|моя брон|где моя|подтвержд|booking|код брон)/.test(t)) {
    if (!user) {
      return {
        reply: 'Чтобы посмотреть статус бронирования, войдите в аккаунт. После входа я покажу все ваши брони и их статусы.',
        suggestions,
        actions: [{ label: 'Войти', href: 'entrance.html' }],
      };
    }
    if (!bookings.length) {
      return {
        reply: 'У вас пока нет бронирований. Давайте подберём отель — назовите направление или бюджет.',
        suggestions: listHotels(hotels),
        actions: [{ label: 'Подобрать отель', href: 'hotels.html' }],
      };
    }
    const lines = bookings.slice(0, 3).map((b) => {
      const status = b.status === 'paid' ? 'оплачено ✅' : b.status === 'cancelled' ? 'отменено' : 'ожидает оплаты ⏳';
      return `• ${b.hotel_name || 'Отель'} (${b.booking_code}): ${b.check_in} → ${b.check_out}, ${fmt(b.total_price)} ₽ — ${status}`;
    });
    const unpaid = bookings.find((b) => b.status === 'pending');
    if (unpaid) actions.push({ label: 'Оплатить бронь', href: `payment.html?bookingId=${unpaid.id}` });
    actions.push({ label: 'Все бронирования', href: 'confirmation.html' });
    return {
      reply: `Ваши последние бронирования:\n${lines.join('\n')}`,
      suggestions,
      actions,
    };
  }

  // 3. Оплата
  if (/(оплат|заплат|карт|платеж|плачу|pay)/.test(t)) {
    const unpaid = bookings.find((b) => b.status === 'pending');
    if (unpaid) {
      return {
        reply: `Оплата проходит на странице бронирования. У вас есть неоплаченная бронь «${unpaid.hotel_name}» на сумму ${fmt(unpaid.total_price)} ₽ — можно оплатить прямо сейчас.`,
        suggestions,
        actions: [{ label: 'Перейти к оплате', href: `payment.html?bookingId=${unpaid.id}` }],
      };
    }
    return {
      reply: 'Оплата принимается банковской картой (МИР, Visa, Mastercard). После оплаты статус брони меняется на «оплачено», и приходит подтверждение. Сначала выберите отель и даты, затем перейдёте к оплате.',
      suggestions,
      actions: [{ label: 'Выбрать отель', href: 'hotels.html' }],
    };
  }

  // 4. Помощь с бронированием / как забронировать
  if (/(как заброн|как брон|оформить|забронир|как купить|инструкц)/.test(t)) {
    return {
      reply: 'Бронирование в 4 шага:\n1) Откройте карточку отеля.\n2) Выберите даты заезда и выезда и число гостей.\n3) Нажмите «Проверить доступность» — я рассчитаю стоимость.\n4) Нажмите «Забронировать» и перейдите к оплате.',
      suggestions: listHotels(hotels),
      actions: [{ label: 'Перейти к отелям', href: 'hotels.html' }],
    };
  }

  // 5. Отмена / возврат
  if (/(отмен|верн|возврат|refund|расторг)/.test(t)) {
    return {
      reply: 'Отмена возможна в личном кабинете. Бесплатная отмена обычно доступна за 24 часа до заезда (зависит от тарифа отеля). После отмены номер снова становится доступен для бронирования.',
      suggestions,
      actions: [{ label: 'Мои бронирования', href: 'confirmation.html' }],
    };
  }

  // 6. Подбор по бюджету
  const budget = extractBudget(t);
  if (budget && (/(до|бюджет|дешев|недорог|за|руб|цена|стоит|стоим)/.test(t) || /\d/.test(t))) {
    const matching = hotels
      .filter((h) => Number(h.base_price) <= budget)
      .sort((a, b) => a.base_price - b.base_price);
    if (matching.length) {
      return {
        reply: `Нашёл ${matching.length} отел(я/ей) с ценой до ${fmt(budget)} ₽ за ночь. Вот лучшие варианты:`,
        suggestions: listHotels(matching),
        actions: [{ label: 'Все отели', href: 'hotels.html' }],
      };
    }
    const cheapest = [...hotels].sort((a, b) => a.base_price - b.base_price)[0];
    return {
      reply: cheapest
        ? `В пределах ${fmt(budget)} ₽ за ночь пока ничего нет. Самый доступный вариант — «${cheapest.name}» от ${fmt(cheapest.base_price)} ₽/ночь.`
        : 'Пока не могу подобрать отель по этому бюджету.',
      suggestions: cheapest ? listHotels([cheapest]) : [],
      actions: [{ label: 'Все отели', href: 'hotels.html' }],
    };
  }

  // 7. Подбор по направлению
  const destinations = [...new Set(hotels.map((h) => norm(h.destination)))];
  const matchedDest = destinations.find((d) => d && t.includes(d.split(' ')[0]));
  if (matchedDest || /(пляж|мор|берег|куда|направлен|отдых|поехать|тур|курорт|город|остров)/.test(t)) {
    let pool = hotels;
    let where = '';
    if (matchedDest) {
      pool = hotels.filter((h) => norm(h.destination) === matchedDest);
      where = ` в направлении «${pool[0] ? pool[0].destination : matchedDest}»`;
    }
    pool = [...pool].sort((a, b) => b.star_rating - a.star_rating);
    if (pool.length) {
      return {
        reply: `Вот подходящие отели${where}. Откройте карточку, чтобы выбрать даты и узнать точную стоимость:`,
        suggestions: listHotels(pool),
        actions: [{ label: 'Каталог направлений', href: 'destinations.html' }],
      };
    }
  }

  // 8. Навигация по сайту
  if (/(где найти|как найти|раздел|страниц|меню|навигац|профиль|кабинет)/.test(t)) {
    return {
      reply: 'Подскажу по разделам: «Отели» — каталог с поиском, карточка отеля — выбор дат и бронирование, «Оплата» — оплата брони, «Мои бронирования» — история и статусы, «Профиль» — данные аккаунта.',
      suggestions,
      actions: [
        { label: 'Отели', href: 'hotels.html' },
        { label: 'Мои бронирования', href: 'confirmation.html' },
      ],
    };
  }

  // 9. Контекстная подсказка по странице
  if (page === 'hotel-detail') {
    return {
      reply: 'Чтобы забронировать этот отель: выберите даты заезда и выезда, укажите гостей и нажмите «Проверить доступность» — я посчитаю итоговую стоимость с налогами и сбором. Нужна помощь с датами или ценой?',
      suggestions,
      actions: [],
    };
  }
  if (page === 'payment') {
    return {
      reply: 'На странице оплаты проверьте сумму и данные брони, введите данные карты и нажмите «Оплатить». После успешной оплаты статус станет «оплачено», и откроется подтверждение.',
      suggestions,
      actions: [],
    };
  }

  // 10. Фолбэк — всё равно полезный
  const topHotels = [...hotels].sort((a, b) => b.star_rating - a.star_rating);
  return {
    reply: 'Могу помочь подобрать отель по направлению или бюджету, рассчитать стоимость, подсказать статус брони и провести по оформлению. Например: «отель у моря до 20000» или «статус моей брони». Популярные варианты сейчас:',
    suggestions: listHotels(topHotels),
    actions: [{ label: 'Все отели', href: 'hotels.html' }],
  };
}

module.exports = { generateReply };
