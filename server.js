const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./modules/database');
const { getBot } = require('./modules/botInstance');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'luxe-exchange-admin-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }
  res.redirect('/login');
}

// ============================================================
// AUTH ROUTES
// ============================================================

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.admin = {
    id: admin.id,
    username: admin.username,
    telegram_id: admin.telegram_id,
    is_super_admin: admin.is_super_admin
  };

  res.json({ success: true, redirect: '/admin' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ============================================================
// DASHBOARD
// ============================================================

app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// ============================================================
// API ROUTES
// ============================================================

// Stats
app.get('/api/stats', requireAuth, (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const orderCount = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  const pendingCount = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").get().count;
  const confirmedCount = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'confirmed'").get().count;
  const rejectedCount = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'rejected'").get().count;
  
  const maintenance = db.prepare("SELECT value FROM bot_settings WHERE key = 'maintenance'").get();

  res.json({
    users: userCount,
    orders: orderCount,
    pending: pendingCount,
    confirmed: confirmedCount,
    rejected: rejectedCount,
    maintenance: maintenance?.value || 'off'
  });
});

// TON Prices
app.get('/api/ton-prices', requireAuth, (req, res) => {
  const prices = db.prepare('SELECT * FROM ton_prices ORDER BY ton_amount ASC').all();
  res.json(prices);
});

app.post('/api/ton-prices', requireAuth, (req, res) => {
  const { ton_amount, mmk_price } = req.body;
  if (!ton_amount || !mmk_price) return res.status(400).json({ error: 'Missing fields' });
  db.prepare('INSERT INTO ton_prices (ton_amount, mmk_price) VALUES (?, ?)').run(ton_amount, mmk_price);
  res.json({ success: true });
});

app.put('/api/ton-prices/:id', requireAuth, (req, res) => {
  const { ton_amount, mmk_price, is_active } = req.body;
  db.prepare('UPDATE ton_prices SET ton_amount = ?, mmk_price = ?, is_active = ? WHERE id = ?')
    .run(ton_amount, mmk_price, is_active !== undefined ? is_active : 1, req.params.id);
  res.json({ success: true });
});

app.delete('/api/ton-prices/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM ton_prices WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// USDT Prices
app.get('/api/usdt-prices', requireAuth, (req, res) => {
  const prices = db.prepare('SELECT * FROM usdt_prices ORDER BY usdt_amount ASC').all();
  res.json(prices);
});

app.post('/api/usdt-prices', requireAuth, (req, res) => {
  const { usdt_amount, mmk_price } = req.body;
  if (!usdt_amount || !mmk_price) return res.status(400).json({ error: 'Missing fields' });
  db.prepare('INSERT INTO usdt_prices (usdt_amount, mmk_price) VALUES (?, ?)').run(usdt_amount, mmk_price);
  res.json({ success: true });
});

app.put('/api/usdt-prices/:id', requireAuth, (req, res) => {
  const { usdt_amount, mmk_price, is_active } = req.body;
  db.prepare('UPDATE usdt_prices SET usdt_amount = ?, mmk_price = ?, is_active = ? WHERE id = ?')
    .run(usdt_amount, mmk_price, is_active !== undefined ? is_active : 1, req.params.id);
  res.json({ success: true });
});

app.delete('/api/usdt-prices/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM usdt_prices WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Star Prices
app.get('/api/star-prices', requireAuth, (req, res) => {
  const prices = db.prepare('SELECT * FROM star_prices ORDER BY star_amount ASC').all();
  res.json(prices);
});

app.post('/api/star-prices', requireAuth, (req, res) => {
  const { star_amount, mmk_price } = req.body;
  if (!star_amount || !mmk_price) return res.status(400).json({ error: 'Missing fields' });
  db.prepare('INSERT INTO star_prices (star_amount, mmk_price) VALUES (?, ?)').run(star_amount, mmk_price);
  res.json({ success: true });
});

app.put('/api/star-prices/:id', requireAuth, (req, res) => {
  const { star_amount, mmk_price, is_active } = req.body;
  db.prepare('UPDATE star_prices SET star_amount = ?, mmk_price = ?, is_active = ? WHERE id = ?')
    .run(star_amount, mmk_price, is_active !== undefined ? is_active : 1, req.params.id);
  res.json({ success: true });
});

app.delete('/api/star-prices/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM star_prices WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Premium Prices
app.get('/api/premium-prices', requireAuth, (req, res) => {
  const prices = db.prepare('SELECT * FROM premium_prices ORDER BY id ASC').all();
  res.json(prices);
});

app.post('/api/premium-prices', requireAuth, (req, res) => {
  const { duration, mmk_price } = req.body;
  if (!duration || !mmk_price) return res.status(400).json({ error: 'Missing fields' });
  db.prepare('INSERT INTO premium_prices (duration, mmk_price) VALUES (?, ?)').run(duration, mmk_price);
  res.json({ success: true });
});

app.put('/api/premium-prices/:id', requireAuth, (req, res) => {
  const { duration, mmk_price, is_active } = req.body;
  db.prepare('UPDATE premium_prices SET duration = ?, mmk_price = ?, is_active = ? WHERE id = ?')
    .run(duration, mmk_price, is_active !== undefined ? is_active : 1, req.params.id);
  res.json({ success: true });
});

app.delete('/api/premium-prices/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM premium_prices WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Exchange Wallets
app.get('/api/exchange-wallets', requireAuth, (req, res) => {
  const wallets = db.prepare('SELECT * FROM exchange_wallets ORDER BY id ASC').all();
  res.json(wallets);
});

app.post('/api/exchange-wallets', requireAuth, (req, res) => {
  const { name, uid, address } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing name' });
  db.prepare('INSERT INTO exchange_wallets (name, uid, address) VALUES (?, ?, ?)').run(name, uid || null, address || null);
  res.json({ success: true });
});

app.put('/api/exchange-wallets/:id', requireAuth, (req, res) => {
  const { name, uid, address, is_active } = req.body;
  db.prepare('UPDATE exchange_wallets SET name = ?, uid = ?, address = ?, is_active = ? WHERE id = ?')
    .run(name, uid, address, is_active !== undefined ? is_active : 1, req.params.id);
  res.json({ success: true });
});

app.delete('/api/exchange-wallets/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM exchange_wallets WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// TON Addresses
app.get('/api/ton-addresses', requireAuth, (req, res) => {
  const addrs = db.prepare('SELECT * FROM ton_addresses ORDER BY id ASC').all();
  res.json(addrs);
});

app.post('/api/ton-addresses', requireAuth, (req, res) => {
  const { network, address } = req.body;
  if (!network || !address) return res.status(400).json({ error: 'Missing fields' });
  db.prepare('INSERT INTO ton_addresses (network, address) VALUES (?, ?)').run(network, address);
  res.json({ success: true });
});

app.put('/api/ton-addresses/:id', requireAuth, (req, res) => {
  const { network, address, is_active } = req.body;
  db.prepare('UPDATE ton_addresses SET network = ?, address = ?, is_active = ? WHERE id = ?')
    .run(network, address, is_active !== undefined ? is_active : 1, req.params.id);
  res.json({ success: true });
});

app.delete('/api/ton-addresses/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM ton_addresses WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Payment Info
app.get('/api/payment-info', requireAuth, (req, res) => {
  const info = db.prepare('SELECT * FROM payment_info ORDER BY id ASC').all();
  res.json(info);
});

app.post('/api/payment-info', requireAuth, (req, res) => {
  const { name, phone_number, payment_method } = req.body;
  if (!name || !phone_number || !payment_method) return res.status(400).json({ error: 'Missing fields' });
  db.prepare('INSERT INTO payment_info (name, phone_number, payment_method) VALUES (?, ?, ?)').run(name, phone_number, payment_method);
  res.json({ success: true });
});

app.put('/api/payment-info/:id', requireAuth, (req, res) => {
  const { name, phone_number, payment_method, is_active } = req.body;
  db.prepare('UPDATE payment_info SET name = ?, phone_number = ?, payment_method = ?, is_active = ? WHERE id = ?')
    .run(name, phone_number, payment_method, is_active !== undefined ? is_active : 1, req.params.id);
  res.json({ success: true });
});

app.delete('/api/payment-info/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM payment_info WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Orders
app.get('/api/orders', requireAuth, (req, res) => {
  const status = req.query.status || 'all';
  let orders;
  if (status === 'all') {
    orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  } else {
    orders = db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC').all(status);
  }
  res.json(orders);
});

app.put('/api/orders/:id/confirm', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  db.prepare("UPDATE orders SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);

  // Notify user via bot
  try {
    const bot = getBot();
    if (bot) {
      bot.sendMessage(order.telegram_id, '✅ သင်၏ဝယ်ယူမှုအောင်မြင်ပါသည်။', {
        reply_markup: {
          keyboard: [
            ['Back Main Menu'],
            ['Customer Support']
          ],
          resize_keyboard: true
        }
      });
    }
  } catch (e) {
    console.error('Bot notification error:', e);
  }

  res.json({ success: true });
});

app.put('/api/orders/:id/reject', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  db.prepare("UPDATE orders SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);

  try {
    const bot = getBot();
    if (bot) {
      bot.sendMessage(order.telegram_id, '❌ သင်၏ဝယ်ယူမှု မအောင်မြင်ပါ။ ကျေးဇူးပြု၍ Customer Support ကိုဆက်သွယ်ပါ။', {
        reply_markup: {
          keyboard: [
            ['Back Main Menu'],
            ['Customer Support']
          ],
          resize_keyboard: true
        }
      });
    }
  } catch (e) {
    console.error('Bot notification error:', e);
  }

  res.json({ success: true });
});

// Maintenance
app.post('/api/maintenance/toggle', requireAuth, (req, res) => {
  const current = db.prepare("SELECT value FROM bot_settings WHERE key = 'maintenance'").get();
  const newVal = current.value === 'on' ? 'off' : 'on';
  db.prepare("UPDATE bot_settings SET value = ? WHERE key = 'maintenance'").run(newVal);
  res.json({ success: true, maintenance: newVal });
});

// Users
app.get('/api/users', requireAuth, (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY last_active DESC LIMIT 100').all();
  res.json(users);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Admin Panel running on http://0.0.0.0:${PORT}`);
});

module.exports = app;
