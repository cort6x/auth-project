'use strict';
const { validateDates, computeQuote, checkAvailability, nightsBetween, parseDateUTC } = require('./pricing');
const { generateReply } = require('./chatbot');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name); }
}

console.log('— Даты —');
// Главный баг из ТЗ: выезд позже заезда не должен давать ошибку.
ok('корректный диапазон валиден', validateDates('2030-01-10', '2030-01-17').valid === true);
ok('ночей считается 7', validateDates('2030-01-10', '2030-01-17').nights === 7);
ok('выезд раньше заезда — ошибка', validateDates('2030-01-17', '2030-01-10').valid === false);
ok('равные даты — ошибка', validateDates('2030-01-10', '2030-01-10').valid === false);
ok('заезд в прошлом — ошибка', validateDates('2000-01-10', '2000-01-17').valid === false);
ok('кривая дата — ошибка', validateDates('2030-13-40', '2030-01-17').valid === false);
ok('нет таймзонного сдвига (1 ночь)', nightsBetween('2030-03-01', '2030-03-02') === 1);
ok('переход через месяц считается верно', nightsBetween('2030-01-30', '2030-02-02') === 3);

console.log('— Расчёт цены —');
const hotel = { base_price: 10000, tax_rate: 0.12, service_fee: 1500 };
const q = computeQuote(hotel, { check_in: '2030-03-10', check_out: '2030-03-13', adults: 2, children: 0, rooms: 1 });
ok('нет ошибки', q.error === null);
ok('3 ночи', q.nights === 3);
ok('nightlyRate = base (вне сезона)', q.nightlyRate === 10000);
ok('subtotal = 30000', q.subtotal === 30000);
ok('taxes = 3600', q.taxes === 3600);
ok('serviceFee = 1500', q.serviceFee === 1500);
ok('total = 35100', q.total === 35100);
ok('breakdown из 3 строк', q.breakdown.length === 3);

const qSeason = computeQuote(hotel, { check_in: '2030-12-20', check_out: '2030-12-22', adults: 2 });
ok('высокий сезон дороже (x1.25)', qSeason.nightlyRate === 12500);

const qErr = computeQuote(hotel, { check_in: '2030-12-22', check_out: '2030-12-20' });
ok('расчёт при кривых датах возвращает error', typeof qErr.error === 'string');

const qRooms = computeQuote(hotel, { check_in: '2030-03-10', check_out: '2030-03-12', adults: 4 });
ok('4 гостя -> 2 комнаты автоматически', qRooms.rooms === 2);

console.log('— Доступность —');
const existing = [{ check_in: '2030-05-10', check_out: '2030-05-15', rooms: 9, status: 'paid' }];
ok('пересечение, мало мест -> занято', checkAvailability(existing, { check_in: '2030-05-12', check_out: '2030-05-14', rooms: 2 }, 10).available === false);
ok('нет пересечения -> свободно', checkAvailability(existing, { check_in: '2030-06-01', check_out: '2030-06-03', rooms: 2 }, 10).available === true);
ok('отменённые брони не учитываются', checkAvailability([{ check_in: '2030-05-10', check_out: '2030-05-15', rooms: 10, status: 'cancelled' }], { check_in: '2030-05-11', check_out: '2030-05-12', rooms: 1 }, 10).available === true);

console.log('— Чатбот —');
const hotels = [
  { slug: 'a', name: 'Бюджетный', destination: 'Пунта-Кана', star_rating: 4.2, base_price: 9000 },
  { slug: 'b', name: 'Премиум', destination: 'Пунта-Кана', star_rating: 4.8, base_price: 18000 },
  { slug: 'c', name: 'Морской', destination: 'Таиланд', star_rating: 4.6, base_price: 12000 },
];
const r1 = generateReply('отель до 10000', { hotels });
ok('бюджет: подобрал только подходящий', r1.suggestions.length === 1 && r1.suggestions[0].title === 'Бюджетный');
const r2 = generateReply('хочу в Таиланд', { hotels });
ok('направление: нашёл отель в Таиланде', r2.suggestions.some(s => s.title === 'Морской'));
const r3 = generateReply('статус моей брони', { hotels, user: { username: 'Иван' }, bookings: [{ id: 5, hotel_name: 'Премиум', booking_code: 'ST-AB12', check_in: '2030-01-01', check_out: '2030-01-05', total_price: 80000, status: 'pending' }] });
ok('статус: упомянул код брони', /ST-AB12/.test(r3.reply));
ok('статус: предложил оплатить', r3.actions.some(a => /payment/.test(a.href)));
const r4 = generateReply('статус брони', { hotels, user: null });
ok('статус без логина -> просит войти', r4.actions.some(a => /entrance/.test(a.href)));
const r5 = generateReply('как забронировать?', { hotels });
ok('инструкция по бронированию', /шаг/i.test(r5.reply) || /1\)/.test(r5.reply));

console.log(`\nИтого: ${pass} прошло, ${fail} упало`);
process.exit(fail ? 1 : 0);
