const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const { computeQuote, checkAvailability } = require('./lib/pricing');
const { generateReply } = require('./lib/chatbot');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'users.db');
const JWT_SECRET = process.env.JWT_SECRET || 'svoy-tourist-secret-2024';
const ROOM_CAPACITY = 10; // условный фонд номеров на отель (расширяемо)

app.use(cors());
app.use(express.json());
app.use(express.static('.'));
 
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/entrance.html', (req, res) => res.sendFile(path.join(__dirname, 'entrance.html')));
app.get('/profile.html', (req, res) => res.sendFile(path.join(__dirname, 'profile.html')));
 
// ---------- БАЗА ДАННЫХ (3 таблицы: users, hotels, bookings) ----------
const db = new sqlite3.Database('./users.db', (err) => {
  if (err) return console.error('Ошибка подключения к БД:', err.message);
  console.log('✅ Подключено к SQLite');
  initDatabase();
});
 
function initDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS hotels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      destination TEXT NOT NULL,
      city TEXT,
      region TEXT,
      star_rating REAL NOT NULL DEFAULT 0,
      base_price REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      service_fee REAL NOT NULL DEFAULT 0,
      image TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      hotel_id INTEGER NOT NULL,
      check_in DATE NOT NULL,
      check_out DATE NOT NULL,
      adults INTEGER NOT NULL DEFAULT 1,
      children INTEGER NOT NULL DEFAULT 0,
      rooms INTEGER NOT NULL DEFAULT 1,
      guests_name TEXT,
      guests_phone TEXT,
      guests_email TEXT,
      nights INTEGER NOT NULL DEFAULT 1,
      nightly_rate REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      taxes REAL NOT NULL DEFAULT 0,
      service_fee REAL NOT NULL DEFAULT 0,
      total_price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      booking_code TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(hotel_id) REFERENCES hotels(id)
    )`, () => { ensureUserRoleColumn(); seedHotels(); });
  });
}
 
// Расширяем существующую таблицу users полем role (без новых таблиц).
// Роль хранится прямо в users: 'user' | 'admin'.
function ensureUserRoleColumn() {
  db.all('PRAGMA table_info(users)', (err, cols) => {
    if (err) return;
    const hasRole = (cols || []).some((c) => c.name === 'role');
    const finish = () => seedAdmin();
    if (hasRole) return finish();
    db.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'", () => finish());
  });
}
 
// Гарантируем наличие администратора (логин/пароль см. README).
function seedAdmin() {
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@svoy-turist.ru';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
  db.get('SELECT id, role FROM users WHERE email = ?', [ADMIN_EMAIL], async (err, row) => {
    if (err) return;
    try {
      if (!row) {
        const hashed = await bcrypt.hash(ADMIN_PASSWORD, 10);
        db.run(
          "INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, 'admin')",
          ['Администратор', ADMIN_EMAIL, hashed],
          () => console.log(`👑 Создан администратор: ${ADMIN_EMAIL}`)
        );
      } else if (row.role !== 'admin') {
        db.run("UPDATE users SET role = 'admin' WHERE id = ?", [row.id]);
      }
    } catch (_) {}
  });
}
 
function seedHotels() {
  const hotels = [
    ['occidental-punta-cana','Occidental Punta Cana','Пунта-Кана','Пунта-Кана','La Altagracia',4.6,12500,0.12,1200,'https://ak-d.tripcdn.com/images/22071a0000019bzi3C242_R_960_660_R5_D.jpg','Курортный отель «всё включено» рядом с пляжами Бавао и Кортесито: бассейны, рестораны и прямой выход к морю.'],
    ['barcelo-bavaro-palace','Barceló Bávaro Palace','Пунта-Кана','Пунта-Кана','La Altagracia',4.8,16800,0.12,1500,'https://hotels.sletat.ru/i/f/95919_0.jpg','Премиальный пляжный отель с большим выбором ресторанов, спа и собственным коралловым рифом.'],
    ['majestic-mirage-punta-cana','Majestic Mirage Punta Cana','Пунта-Кана','Пунта-Кана','La Altagracia',4.7,19800,0.12,1800,'https://dynamic-media-cdn.tripadvisor.com/media/photo-o/0d/5f/b7/be/majestic-mirage-punta.jpg?w=900&h=500&s=1','Курорт «всё включено» только для размещения люкс: бассейны, водные виды спорта и сервис премиум-класса.'],
    ['phu-quoc-vinpearl','Vinpearl Resort Phu Quoc','Фукуок','Фукуок','Кьензянг',4.5,9800,0.10,900,'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=900','Тропический курорт на берегу Фукуока с длинным частным пляжем, аквапарком и сафари-парком рядом.'],
    ['phi-phi-island-resort','Phi Phi Island Village','Таиланд','Краби','Краби',4.6,11200,0.10,1000,'https://images.unsplash.com/photo-1537956965359-7573183d1f57?w=900','Бунгало в окружении джунглей на островах Пхи-Пхи: бирюзовая вода, дайвинг и спа на берегу.'],
    ['sunset-town-phuquoc','Sunset Town Resort','Фукуок','Фукуок','Кьензянг',4.3,8600,0.10,800,'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=900','Уютный отель в средиземноморском стиле на юге Фукуока рядом с канатной дорогой и закатами.'],
  ];
  db.get('SELECT COUNT(*) as c FROM hotels', (err, row) => {
    if (row && row.c === 0) {
      const stmt = db.prepare('INSERT INTO hotels (slug, name, destination, city, region, star_rating, base_price, tax_rate, service_fee, image, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      hotels.forEach(h => stmt.run(h));
      stmt.finalize();
      console.log('🏨 Отели добавлены в БД');
    }
  });
}
 
// ---------- ВСПОМОГАТЕЛЬНОЕ ----------
function authRequired(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Неверный или истёкший токен' });
    req.user = decoded;
    next();
  });
}
function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next();
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (!err) req.user = decoded;
    next();
  });
}
// Доступ только для администратора. Роль перепроверяется по БД,
// чтобы старый токен нельзя было использовать после смены прав.
function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    db.get('SELECT role FROM users WHERE id = ?', [req.user.userId], (err, row) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      if (!row || row.role !== 'admin') return res.status(403).json({ error: 'Доступ только для администратора' });
      req.user.role = 'admin';
      next();
    });
  });
}
const dbGet = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
const dbAll = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
const dbRun = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
 
// ---------- АВТОРИЗАЦИЯ ----------
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (password.length < 4) return res.status(400).json({ error: 'Пароль слишком короткий' });
    const exists = await dbGet('SELECT id FROM users WHERE email = ? OR username = ?', [email, username]);
    if (exists) return res.status(400).json({ error: 'Email или имя уже зарегистрированы' });
    const hashed = await bcrypt.hash(password, 10);
    const r = await dbRun('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username, email, hashed]);
    const token = jwt.sign({ userId: r.lastID, username, email, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, message: 'Регистрация успешна!', token, user: { id: r.lastID, username, email, role: 'user' } });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
 
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Заполните все поля' });
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!user) return res.status(400).json({ error: 'Неверный email или пароль' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Неверный email или пароль' });
    const role = user.role || 'user';
    const token = jwt.sign({ userId: user.id, username: user.username, email: user.email, role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user.id, username: user.username, email: user.email, role } });
  });
});
 
app.get('/api/profile', authRequired, (req, res) => {
  db.get('SELECT id, username, email, role FROM users WHERE id = ?', [req.user.userId], (err, row) => {
    if (err || !row) return res.json({ user: req.user });
    res.json({ user: { ...req.user, ...row } });
  });
});
 
// ---------- ОТЕЛИ ----------
app.get('/api/hotels', async (req, res) => {
  try {
    const { destination, q, min_price, max_price, sort } = req.query;
    const where = [];
    const params = [];
    if (destination) { where.push('destination = ?'); params.push(destination); }
    if (q) { where.push('(name LIKE ? OR destination LIKE ? OR city LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (min_price) { where.push('base_price >= ?'); params.push(Number(min_price)); }
    if (max_price) { where.push('base_price <= ?'); params.push(Number(max_price)); }
    let order = 'star_rating DESC, base_price ASC';
    if (sort === 'price_asc') order = 'base_price ASC';
    else if (sort === 'price_desc') order = 'base_price DESC';
    else if (sort === 'rating') order = 'star_rating DESC';
    const sql = `SELECT * FROM hotels ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
    const rows = await dbAll(sql, params);
    const destinations = (await dbAll('SELECT DISTINCT destination FROM hotels ORDER BY destination')).map(r => r.destination);
    res.json({ hotels: rows, destinations });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка получения отелей' });
  }
});
 
app.get('/api/hotels/:slug', async (req, res) => {
  try {
    const row = await dbGet('SELECT * FROM hotels WHERE slug = ?', [req.params.slug]);
    if (!row) return res.status(404).json({ error: 'Отель не найден' });
    res.json({ hotel: row });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка получения отеля' });
  }
});
 
// ---------- РАСЧЁТ + ДОСТУПНОСТЬ (без сохранения) ----------
app.post('/api/bookings/quote', async (req, res) => {
  try {
    const { slug, hotel_id } = req.body;
    const hotel = slug
      ? await dbGet('SELECT * FROM hotels WHERE slug = ?', [slug])
      : await dbGet('SELECT * FROM hotels WHERE id = ?', [hotel_id]);
    if (!hotel) return res.status(404).json({ error: 'Отель не найден' });
 
    const quote = computeQuote(hotel, req.body);
    if (quote.error) return res.status(400).json({ error: quote.error });
 
    const existing = await dbAll(
      "SELECT check_in, check_out, rooms, status FROM bookings WHERE hotel_id = ? AND status != 'cancelled'",
      [hotel.id]
    );
    const avail = checkAvailability(existing, { ...req.body, rooms: quote.rooms }, ROOM_CAPACITY);
    res.json({ hotel: { id: hotel.id, name: hotel.name, slug: hotel.slug }, quote, availability: avail });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка расчёта' });
  }
});
 
// ---------- СОЗДАНИЕ БРОНИ (сервер — источник истины) ----------
app.post('/api/bookings', authRequired, async (req, res) => {
  try {
    const { slug, hotel_id, check_in, check_out, guests_name = '', guests_phone = '', guests_email = '' } = req.body;
    const hotel = slug
      ? await dbGet('SELECT * FROM hotels WHERE slug = ?', [slug])
      : await dbGet('SELECT * FROM hotels WHERE id = ?', [hotel_id]);
    if (!hotel) return res.status(404).json({ error: 'Отель не найден' });
 
    // Цена пересчитывается на сервере, фронту не доверяем.
    const quote = computeQuote(hotel, req.body);
    if (quote.error) return res.status(400).json({ error: quote.error });
 
    const existing = await dbAll(
      "SELECT check_in, check_out, rooms, status FROM bookings WHERE hotel_id = ? AND status != 'cancelled'",
      [hotel.id]
    );
    const avail = checkAvailability(existing, { check_in, check_out, rooms: quote.rooms }, ROOM_CAPACITY);
    if (!avail.available) return res.status(409).json({ error: avail.reason || 'Нет свободных номеров на выбранные даты.' });
 
    const code = 'ST-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const r = await dbRun(
      `INSERT INTO bookings (user_id, hotel_id, check_in, check_out, adults, children, rooms, guests_name, guests_phone, guests_email, nights, nightly_rate, subtotal, taxes, service_fee, total_price, status, booking_code)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`,
      [req.user.userId, hotel.id, check_in, check_out, quote.adults, quote.children, quote.rooms,
       guests_name, guests_phone, guests_email, quote.nights, quote.nightlyRate, quote.subtotal,
       quote.taxes, quote.serviceFee, quote.total, code]
    );
    res.json({ success: true, booking: { id: r.lastID, booking_code: code, status: 'pending', total_price: quote.total } });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка создания бронирования' });
  }
});
 
// ---------- МОИ БРОНИ ----------
app.get('/api/bookings/my', authRequired, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT b.*, h.name AS hotel_name, h.slug AS hotel_slug, h.image AS hotel_image, h.destination AS hotel_destination
       FROM bookings b JOIN hotels h ON h.id = b.hotel_id
       WHERE b.user_id = ? ORDER BY b.created_at DESC`,
      [req.user.userId]
    );
    res.json({ bookings: rows });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка получения бронирований' });
  }
});
 
app.get('/api/bookings/:id', authRequired, async (req, res) => {
  try {
    const row = await dbGet(
      `SELECT b.*, h.name AS hotel_name, h.slug AS hotel_slug, h.image AS hotel_image, h.destination AS hotel_destination, h.city AS hotel_city
       FROM bookings b JOIN hotels h ON h.id = b.hotel_id
       WHERE b.id = ? AND b.user_id = ?`,
      [req.params.id, req.user.userId]
    );
    if (!row) return res.status(404).json({ error: 'Бронирование не найдено' });
    res.json({ booking: row });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка получения бронирования' });
  }
});
 
// ---------- ОПЛАТА (mock, архитектурно готова к эквайрингу) ----------
app.post('/api/bookings/:id/pay', authRequired, async (req, res) => {
  try {
    const booking = await dbGet('SELECT * FROM bookings WHERE id = ? AND user_id = ?', [req.params.id, req.user.userId]);
    if (!booking) return res.status(404).json({ error: 'Бронирование не найдено' });
    if (booking.status === 'paid') return res.json({ success: true, booking: { id: booking.id, status: 'paid' } });
 
    // Здесь была бы интеграция с платёжным шлюзом. Сейчас — имитация успешной оплаты.
    await dbRun("UPDATE bookings SET status = 'paid' WHERE id = ?", [booking.id]);
    res.json({ success: true, booking: { id: booking.id, status: 'paid', booking_code: booking.booking_code } });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка оплаты' });
  }
});
 
// ---------- ОТМЕНА ----------
app.post('/api/bookings/:id/cancel', authRequired, async (req, res) => {
  try {
    const booking = await dbGet('SELECT * FROM bookings WHERE id = ? AND user_id = ?', [req.params.id, req.user.userId]);
    if (!booking) return res.status(404).json({ error: 'Бронирование не найдено' });
    await dbRun("UPDATE bookings SET status = 'cancelled' WHERE id = ?", [booking.id]);
    res.json({ success: true, booking: { id: booking.id, status: 'cancelled' } });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка отмены' });
  }
});
 
// ---------- АДМИН-ПАНЕЛЬ (роль admin, поверх 3 таблиц) ----------
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
 
// Сводная статистика для дашборда
app.get('/api/admin/stats', adminRequired, async (req, res) => {
  try {
    const [users, hotels, bookings] = await Promise.all([
      dbGet('SELECT COUNT(*) AS c FROM users'),
      dbGet('SELECT COUNT(*) AS c FROM hotels'),
      dbAll('SELECT status, COUNT(*) AS c, COALESCE(SUM(total_price),0) AS sum FROM bookings GROUP BY status'),
    ]);
    const byStatus = { pending: 0, paid: 0, cancelled: 0 };
    let totalBookings = 0;
    let revenue = 0; // выручка = оплаченные брони
    bookings.forEach((b) => {
      byStatus[b.status] = b.c;
      totalBookings += b.c;
      if (b.status === 'paid') revenue += b.sum;
    });
    const recent = await dbAll(
      `SELECT b.id, b.booking_code, b.status, b.total_price, b.created_at,
              h.name AS hotel_name, u.username AS user_name
       FROM bookings b JOIN hotels h ON h.id = b.hotel_id JOIN users u ON u.id = b.user_id
       ORDER BY b.created_at DESC LIMIT 6`
    );
    res.json({
      users: users.c, hotels: hotels.c, bookings: totalBookings,
      byStatus, revenue, recent,
      attention: byStatus.pending || 0, // брони, ожидающие оплаты
    });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка получения статистики' });
  }
});
 
// Пользователи
app.get('/api/admin/users', adminRequired, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT u.id, u.username, u.email, COALESCE(u.role,'user') AS role, u.created_at,
              COUNT(b.id) AS bookings_count
       FROM users u LEFT JOIN bookings b ON b.user_id = u.id
       GROUP BY u.id ORDER BY u.created_at DESC`
    );
    res.json({ users: rows });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка получения пользователей' });
  }
});
 
// Все брони (с фильтром по статусу)
app.get('/api/admin/bookings', adminRequired, async (req, res) => {
  try {
    const { status } = req.query;
    const where = status && status !== 'all' ? 'WHERE b.status = ?' : '';
    const params = status && status !== 'all' ? [status] : [];
    const rows = await dbAll(
      `SELECT b.*, h.name AS hotel_name, h.destination AS hotel_destination,
              u.username AS user_name, u.email AS user_email
       FROM bookings b JOIN hotels h ON h.id = b.hotel_id JOIN users u ON u.id = b.user_id
       ${where} ORDER BY b.created_at DESC`,
      params
    );
    res.json({ bookings: rows });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка получения бронирований' });
  }
});
 
app.get('/api/admin/bookings/:id', adminRequired, async (req, res) => {
  try {
    const row = await dbGet(
      `SELECT b.*, h.name AS hotel_name, h.destination AS hotel_destination, h.city AS hotel_city,
              u.username AS user_name, u.email AS user_email
       FROM bookings b JOIN hotels h ON h.id = b.hotel_id JOIN users u ON u.id = b.user_id
       WHERE b.id = ?`, [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Бронирование не найдено' });
    res.json({ booking: row });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка получения бронирования' });
  }
});
 
// Смена статуса брони (pending | paid | cancelled)
app.patch('/api/admin/bookings/:id/status', adminRequired, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['pending', 'paid', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Недопустимый статус' });
    const booking = await dbGet('SELECT id FROM bookings WHERE id = ?', [req.params.id]);
    if (!booking) return res.status(404).json({ error: 'Бронирование не найдено' });
    await dbRun('UPDATE bookings SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true, booking: { id: Number(req.params.id), status } });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка обновления статуса' });
  }
});
 
// Добавление отеля
app.post('/api/admin/hotels', adminRequired, async (req, res) => {
  try {
    const h = req.body || {};
    if (!h.name || !h.destination) return res.status(400).json({ error: 'Укажите название и направление' });
    const slug = (h.slug && String(h.slug).trim()) ||
      String(h.name).toLowerCase().replace(/[^a-z0-9а-я]+/gi, '-').replace(/^-+|-+$/g, '') + '-' + Math.random().toString(36).slice(2, 5);
    const exists = await dbGet('SELECT id FROM hotels WHERE slug = ?', [slug]);
    if (exists) return res.status(400).json({ error: 'Отель с таким slug уже существует' });
    const r = await dbRun(
      `INSERT INTO hotels (slug, name, destination, city, region, star_rating, base_price, tax_rate, service_fee, image, description)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [slug, h.name, h.destination, h.city || '', h.region || '',
       Number(h.star_rating) || 0, Number(h.base_price) || 0,
       Number(h.tax_rate) || 0, Number(h.service_fee) || 0, h.image || '', h.description || '']
    );
    res.json({ success: true, hotel: { id: r.lastID, slug } });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка добавления отеля' });
  }
});
 
// Редактирование отеля
app.put('/api/admin/hotels/:id', adminRequired, async (req, res) => {
  try {
    const h = req.body || {};
    const existing = await dbGet('SELECT * FROM hotels WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Отель не найден' });
    await dbRun(
      `UPDATE hotels SET name=?, destination=?, city=?, region=?, star_rating=?, base_price=?, tax_rate=?, service_fee=?, image=?, description=? WHERE id=?`,
      [h.name ?? existing.name, h.destination ?? existing.destination, h.city ?? existing.city,
       h.region ?? existing.region, Number(h.star_rating ?? existing.star_rating),
       Number(h.base_price ?? existing.base_price), Number(h.tax_rate ?? existing.tax_rate),
       Number(h.service_fee ?? existing.service_fee), h.image ?? existing.image,
       h.description ?? existing.description, req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка редактирования отеля' });
  }
});
 
// Удаление отеля (запрещаем, если есть активные брони)
app.delete('/api/admin/hotels/:id', adminRequired, async (req, res) => {
  try {
    const active = await dbGet(
      "SELECT COUNT(*) AS c FROM bookings WHERE hotel_id = ? AND status != 'cancelled'", [req.params.id]);
    if (active && active.c > 0) {
      return res.status(409).json({ error: `Нельзя удалить: есть активных броней — ${active.c}. Сначала отмените их.` });
    }
    await dbRun('DELETE FROM hotels WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка удаления отеля' });
  }
});
 
// ---------- AI-ЧАТБОТ (на данных сайта) ----------
app.post('/api/chat', optionalAuth, async (req, res) => {
  try {
    const { message, page } = req.body;
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'Пустое сообщение' });
    const hotels = await dbAll('SELECT slug, name, destination, city, star_rating, base_price FROM hotels');
    let bookings = [];
    let user = null;
    if (req.user) {
      user = { username: req.user.username };
      bookings = await dbAll(
        `SELECT b.id, b.booking_code, b.check_in, b.check_out, b.total_price, b.status, h.name AS hotel_name
         FROM bookings b JOIN hotels h ON h.id = b.hotel_id
         WHERE b.user_id = ? ORDER BY b.created_at DESC`,
        [req.user.userId]
      );
    }
    const reply = generateReply(message, { hotels, bookings, user, page });
    res.json(reply);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чат-бота' });
  }
});
 
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
  console.log('📊 БД: users.db (users, hotels, bookings)');
});