'use strict';

/**
 * Чистая бизнес-логика бронирования: парсинг и валидация дат,
 * расчёт количества ночей и итоговой стоимости.
 *
 * Модуль НЕ зависит от express/sqlite, поэтому его можно
 * подключать и на сервере, и в тестах (node lib/pricing.test.js).
 */

/**
 * Безопасный парсинг даты формата YYYY-MM-DD в UTC-полночь.
 * Это убирает проблемы с часовыми поясами: разница между двумя
 * датами всегда считается в целых сутках.
 * @returns {number|null} timestamp в UTC или null, если дата некорректна
 */
function parseDateUTC(value) {
  if (value == null) return null;
  const str = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ts = Date.UTC(year, month - 1, day);
  const d = new Date(ts);
  // защита от "перелива" (например 2025-02-31 -> 2025-03-03)
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return ts;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfTodayUTC() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * Подсчёт количества ночей между заездом и выездом.
 */
function nightsBetween(checkIn, checkOut) {
  const a = parseDateUTC(checkIn);
  const b = parseDateUTC(checkOut);
  if (a == null || b == null) return 0;
  return Math.round((b - a) / DAY_MS);
}

/**
 * Валидация дат заезда/выезда.
 * Возвращает { valid, error, nights }.
 * Сравнение ведётся как сравнение календарных значений, а не строк.
 */
function validateDates(checkIn, checkOut, opts = {}) {
  const allowPast = opts.allowPast === true;
  const inTs = parseDateUTC(checkIn);
  const outTs = parseDateUTC(checkOut);

  if (inTs == null || outTs == null) {
    return { valid: false, error: 'Укажите корректные даты заезда и выезда.', nights: 0 };
  }
  if (!allowPast && inTs < startOfTodayUTC()) {
    return { valid: false, error: 'Дата заезда не может быть в прошлом.', nights: 0 };
  }
  if (outTs <= inTs) {
    return { valid: false, error: 'Дата выезда должна быть позже даты заезда.', nights: 0 };
  }
  const nights = Math.round((outTs - inTs) / DAY_MS);
  if (nights > 60) {
    return { valid: false, error: 'Максимальный срок бронирования — 60 ночей.', nights };
  }
  return { valid: true, error: null, nights };
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Расчёт стоимости бронирования на основе данных отеля.
 * Логика полностью на сервере — фронтенд не является источником истины.
 *
 * @param {Object} hotel  запись отеля (base_price, tax_rate, service_fee, ...)
 * @param {Object} params { check_in, check_out, adults, children, rooms }
 * @returns {Object} результат с разбивкой стоимости либо { error }
 */
function computeQuote(hotel, params = {}) {
  if (!hotel) return { error: 'Отель не найден.' };

  const adults = Math.max(1, parseInt(params.adults, 10) || 1);
  const children = Math.max(0, parseInt(params.children, 10) || 0);
  const guests = adults + children;
  // Минимально необходимое число комнат: до 2 гостей на номер.
  let rooms = parseInt(params.rooms, 10);
  if (!rooms || rooms < 1) rooms = Math.max(1, Math.ceil(guests / 2));

  const dateCheck = validateDates(params.check_in, params.check_out, params);
  if (!dateCheck.valid) {
    return { error: dateCheck.error };
  }
  const nights = dateCheck.nights;

  const basePrice = Number(hotel.base_price) || 0;
  const taxRate = Number(hotel.tax_rate) || 0;
  const serviceFeeBase = Number(hotel.service_fee) || 0;

  // Простой сезонный коэффициент (расширяемо): лето/новогодние праздники дороже.
  const month = new Date(parseDateUTC(params.check_in)).getUTCMonth() + 1;
  let seasonMultiplier = 1;
  if (month === 12 || month === 1) seasonMultiplier = 1.25; // высокий сезон
  else if (month >= 6 && month <= 8) seasonMultiplier = 1.15; // лето

  const nightlyRate = round2(basePrice * seasonMultiplier);
  const subtotal = round2(nightlyRate * nights * rooms);
  const taxes = round2(subtotal * taxRate);
  const serviceFee = round2(serviceFeeBase * rooms);
  const total = round2(subtotal + taxes + serviceFee);

  return {
    error: null,
    nights,
    adults,
    children,
    guests,
    rooms,
    seasonMultiplier,
    nightlyRate,
    subtotal,
    taxes,
    serviceFee,
    total,
    breakdown: [
      { label: `${nightlyRate.toLocaleString('ru-RU')} ₽ × ${nights} ноч. × ${rooms} ном.`, amount: subtotal },
      { label: `Налоги и сборы (${Math.round(taxRate * 100)}%)`, amount: taxes },
      { label: 'Сервисный сбор', amount: serviceFee },
    ],
  };
}

/**
 * Базовая проверка доступности по существующим бронированиям.
 * Архитектура рассчитана на расширение под полноценный inventory:
 * сейчас у каждого отеля условный фонд комнат, и мы считаем
 * пересечения дат с активными бронями (pending/paid).
 *
 * @param {Array} bookings  активные брони этого отеля [{check_in, check_out, rooms, status}]
 * @param {Object} params   { check_in, check_out, rooms }
 * @param {number} capacity общий фонд номеров отеля
 */
function checkAvailability(bookings, params, capacity = 10) {
  const reqIn = parseDateUTC(params.check_in);
  const reqOut = parseDateUTC(params.check_out);
  const reqRooms = Math.max(1, parseInt(params.rooms, 10) || 1);
  if (reqIn == null || reqOut == null) {
    return { available: false, reason: 'Некорректные даты.' };
  }
  let booked = 0;
  for (const b of bookings || []) {
    if (b.status === 'cancelled') continue;
    const bIn = parseDateUTC(b.check_in);
    const bOut = parseDateUTC(b.check_out);
    if (bIn == null || bOut == null) continue;
    // пересечение интервалов [reqIn,reqOut) и [bIn,bOut)
    if (reqIn < bOut && bIn < reqOut) {
      booked += Math.max(1, parseInt(b.rooms, 10) || 1);
    }
  }
  const remaining = capacity - booked;
  return {
    available: remaining >= reqRooms,
    remaining: Math.max(0, remaining),
    requested: reqRooms,
    reason: remaining >= reqRooms ? null : 'На выбранные даты нет свободных номеров.',
  };
}

module.exports = {
  parseDateUTC,
  nightsBetween,
  validateDates,
  computeQuote,
  checkAvailability,
  round2,
};
