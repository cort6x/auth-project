'use strict';
// Полный e2e-тест конвейера бронирования на реальном SQLite (node:sqlite)
// и реальных модулях lib/pricing + lib/chatbot. Имитирует то, что делает server.js.
const { DatabaseSync } = require('node:sqlite');
const { computeQuote, checkAvailability } = require('./pricing');
const { generateReply } = require('./chatbot');

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE hotels (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, name TEXT, destination TEXT, city TEXT, star_rating REAL, base_price REAL, tax_rate REAL, service_fee REAL, image TEXT, description TEXT);
  CREATE TABLE bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, hotel_id INTEGER, check_in TEXT, check_out TEXT, adults INTEGER, children INTEGER, rooms INTEGER, nights INTEGER, nightly_rate REAL, subtotal REAL, taxes REAL, service_fee REAL, total_price REAL, status TEXT, booking_code TEXT);
`);
db.prepare('INSERT INTO hotels (slug,name,destination,city,star_rating,base_price,tax_rate,service_fee) VALUES (?,?,?,?,?,?,?,?)')
  .run('occidental-punta-cana','Occidental Punta Cana','Пунта-Кана','Пунта-Кана',4.6,12500,0.12,1200);

let pass=0, fail=0;
const ok=(n,c)=>{ c?(pass++,console.log('  ✅',n)):(fail++,console.log('  ❌',n)); };
const CAP=10;

console.log('— E2E: полный путь бронирования —');

// 1. Каталог
const hotels=db.prepare('SELECT * FROM hotels').all();
ok('каталог отелей не пуст', hotels.length>0);

// 2. Карточка отеля по slug
const hotel=db.prepare('SELECT * FROM hotels WHERE slug=?').get('occidental-punta-cana');
ok('отель найден по slug', !!hotel && hotel.name==='Occidental Punta Cana');

// 3. Quote (расчёт + доступность) — будущие даты
const params={ slug:hotel.slug, check_in:'2031-07-10', check_out:'2031-07-17', adults:2, children:1 };
const quote=computeQuote(hotel, params);
ok('quote без ошибки', quote.error===null);
ok('quote: 7 ночей', quote.nights===7);
ok('quote: total>0', quote.total>0);
const existing0=db.prepare("SELECT check_in,check_out,rooms,status FROM bookings WHERE hotel_id=? AND status!='cancelled'").all(hotel.id);
const avail0=checkAvailability(existing0, {...params, rooms:quote.rooms}, CAP);
ok('изначально доступно', avail0.available===true);

// 4. Создание брони (сервер пересчитывает цену сам)
const code='ST-TEST01';
const ins=db.prepare(`INSERT INTO bookings (user_id,hotel_id,check_in,check_out,adults,children,rooms,nights,nightly_rate,subtotal,taxes,service_fee,total_price,status,booking_code)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`)
  .run(1,hotel.id,params.check_in,params.check_out,quote.adults,quote.children,quote.rooms,quote.nights,quote.nightlyRate,quote.subtotal,quote.taxes,quote.serviceFee,quote.total,code);
const bookingId=ins.lastInsertRowid;
ok('бронь создана, есть id', !!bookingId);

// 5. Бронь сохранена в БД с верной суммой
const saved=db.prepare('SELECT * FROM bookings WHERE id=?').get(bookingId);
ok('бронь в БД', !!saved);
ok('сумма в БД совпадает с расчётом', saved.total_price===quote.total);
ok('статус pending', saved.status==='pending');

// 6. Оплата меняет статус
db.prepare("UPDATE bookings SET status='paid' WHERE id=?").run(bookingId);
const paid=db.prepare('SELECT status FROM bookings WHERE id=?').get(bookingId);
ok('после оплаты статус paid', paid.status==='paid');

// 7. Мои бронирования (JOIN с отелем)
const my=db.prepare(`SELECT b.*, h.name AS hotel_name FROM bookings b JOIN hotels h ON h.id=b.hotel_id WHERE b.user_id=?`).all(1);
ok('мои брони содержат hotel_name', my.length===1 && my[0].hotel_name==='Occidental Punta Cana');

// 8. Доступность учитывает занятые номера: забьём фонд
for(let i=0;i<CAP;i++){
  db.prepare(`INSERT INTO bookings (user_id,hotel_id,check_in,check_out,rooms,status,booking_code) VALUES (2,?,?,?,?, 'paid', ?)`)
    .run(hotel.id,'2031-08-01','2031-08-05',1,'BLK'+i);
}
const existing1=db.prepare("SELECT check_in,check_out,rooms,status FROM bookings WHERE hotel_id=? AND status!='cancelled'").all(hotel.id);
const avail1=checkAvailability(existing1, {check_in:'2031-08-02', check_out:'2031-08-04', rooms:1}, CAP);
ok('переполненные даты -> недоступно', avail1.available===false);

// 9. Чатбот видит реальные данные брони
const chat=generateReply('статус моей брони', { hotels, bookings:my, user:{username:'Тест'} });
ok('чатбот упоминает код брони из БД', chat.reply.includes(code));

console.log(`\nИтого e2e: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);
