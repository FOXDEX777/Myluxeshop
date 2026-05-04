const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'luxe_exchange.db'));
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  -- Users table
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    telegram_username TEXT,
    telegram_first_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Admin users table
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    username TEXT,
    password_hash TEXT,
    is_super_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- TON prices table (V2: separate buy and sell prices)
  CREATE TABLE IF NOT EXISTS ton_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ton_amount REAL NOT NULL,
    mmk_buy_price REAL NOT NULL,
    mmk_sell_price REAL NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- USDT prices table
  CREATE TABLE IF NOT EXISTS usdt_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usdt_amount REAL NOT NULL,
    mmk_price REAL NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Telegram Stars prices table
  CREATE TABLE IF NOT EXISTS star_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    star_amount INTEGER NOT NULL,
    mmk_price REAL NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Telegram Premium prices table
  CREATE TABLE IF NOT EXISTS premium_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    duration TEXT NOT NULL,
    mmk_price REAL NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Exchange/Wallet addresses table
  CREATE TABLE IF NOT EXISTS exchange_wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    uid TEXT,
    address TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Orders table
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT UNIQUE NOT NULL,
    telegram_id TEXT NOT NULL,
    telegram_username TEXT,
    telegram_first_name TEXT,
    order_type TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL,
    mmk_amount REAL,
    wallet_address TEXT,
    exchange_name TEXT,
    payment_method TEXT,
    payment_phone TEXT,
    payment_name TEXT,
    status TEXT DEFAULT 'pending',
    screenshot_file_id TEXT,
    admin_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- User temporary data (for multi-step workflows)
  CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    current_flow TEXT,
    step TEXT,
    temp_data TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Bot settings table
  CREATE TABLE IF NOT EXISTS bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- TON wallet addresses (for sell flow - where users send TON)
  CREATE TABLE IF NOT EXISTS ton_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL,
    address TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Payment info table (for buy flow - where users send MMK)
  CREATE TABLE IF NOT EXISTS payment_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// V2 Migration: Add mmk_sell_price column if it doesn't exist
try {
  const columns = db.prepare("PRAGMA table_info(ton_prices)").all();
  const hasSellPrice = columns.some(c => c.name === 'mmk_sell_price');
  if (!hasSellPrice) {
    console.log('[MIGRATION] Adding mmk_sell_price column to ton_prices...');
    db.exec('ALTER TABLE ton_prices ADD COLUMN mmk_sell_price REAL DEFAULT 0');
    // Copy buy price to sell price for existing rows
    db.exec('UPDATE ton_prices SET mmk_sell_price = mmk_price WHERE mmk_sell_price = 0 OR mmk_sell_price IS NULL');
    console.log('[MIGRATION] Done.');
  }
  // Also rename mmk_price to mmk_buy_price if needed
  const hasBuyPrice = columns.some(c => c.name === 'mmk_buy_price');
  if (!hasBuyPrice && columns.some(c => c.name === 'mmk_price')) {
    console.log('[MIGRATION] Renaming mmk_price to mmk_buy_price...');
    // SQLite doesn't support ALTER COLUMN, so we recreate
    // But since we already have data, let's add the column instead
    db.exec('ALTER TABLE ton_prices ADD COLUMN mmk_buy_price REAL DEFAULT 0');
    db.exec('UPDATE ton_prices SET mmk_buy_price = mmk_price WHERE mmk_buy_price = 0 OR mmk_buy_price IS NULL');
    console.log('[MIGRATION] Done.');
  }
} catch (e) {
  console.error('[MIGRATION] Error:', e.message);
}

// Initialize default data if tables are empty
function initializeDefaults() {
  // Insert super admin
  const adminCount = db.prepare('SELECT COUNT(*) as count FROM admins WHERE telegram_id = ?').get('6078445562');
  if (adminCount.count === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO admins (telegram_id, username, password_hash, is_super_admin) VALUES (?, ?, ?, ?)').run(
      '6078445562', 'admin', hash, 1
    );
  }

  // Insert default TON prices (V2: buy and sell prices)
  const tonCount = db.prepare('SELECT COUNT(*) as count FROM ton_prices').get();
  if (tonCount.count === 0) {
    const tonDefaults = [
      [0.3, 2700, 2300],
      [0.5, 4500, 3000],
      [0.6, 8000, 8000],
      [0.8, 7200, 4900],
      [1, 9000, 70],
      [2, 17000, 17000],
      [5, 42000, 42000]
    ];
    const insertTon = db.prepare('INSERT INTO ton_prices (ton_amount, mmk_buy_price, mmk_sell_price) VALUES (?, ?, ?)');
    for (const [amount, buyPrice, sellPrice] of tonDefaults) {
      insertTon.run(amount, buyPrice, sellPrice);
    }
  }

  // Insert default USDT prices
  const usdtCount = db.prepare('SELECT COUNT(*) as count FROM usdt_prices').get();
  if (usdtCount.count === 0) {
    const usdtDefaults = [
      [1, 4600], [2, 9200], [3, 18400]
    ];
    const insertUsdt = db.prepare('INSERT INTO usdt_prices (usdt_amount, mmk_price) VALUES (?, ?)');
    for (const [amount, price] of usdtDefaults) {
      insertUsdt.run(amount, price);
    }
  }

  // Insert default Star prices
  const starCount = db.prepare('SELECT COUNT(*) as count FROM star_prices').get();
  if (starCount.count === 0) {
    const starDefaults = [
      [50, 3500], [75, 4500], [100, 6000], [150, 9000],
      [250, 14000], [350, 19000], [500, 27000], [750, 40000],
      [1000, 54000], [1500, 79000], [2500, 131000], [5000, 260000],
      [10000, 520000], [25000, 1296277]
    ];
    const insertStar = db.prepare('INSERT INTO star_prices (star_amount, mmk_price) VALUES (?, ?)');
    for (const [amount, price] of starDefaults) {
      insertStar.run(amount, price);
    }
  }

  // Insert default Premium prices
  const premiumCount = db.prepare('SELECT COUNT(*) as count FROM premium_prices').get();
  if (premiumCount.count === 0) {
    const premiumDefaults = [
      ['1 Year (၁နှစ်)', 138000],
      ['6 Months (၆ လ)', 78200],
      ['3 Months (၃ လ)', 59800]
    ];
    const insertPremium = db.prepare('INSERT INTO premium_prices (duration, mmk_price) VALUES (?, ?)');
    for (const [duration, price] of premiumDefaults) {
      insertPremium.run(duration, price);
    }
  }

  // Insert default exchange wallets
  const walletCount = db.prepare('SELECT COUNT(*) as count FROM exchange_wallets').get();
  if (walletCount.count === 0) {
    const walletDefaults = [
      ['Binance Exchange', null, null],
      ['Bitget Exchange', '7671184732', 'TWJ6UyKKwfhe2REJoXfDUEnypDaK1r1eBp'],
      ['OKX Exchange', null, null],
      ['Other Third Party Wallets', null, null]
    ];
    const insertWallet = db.prepare('INSERT INTO exchange_wallets (name, uid, address) VALUES (?, ?, ?)');
    for (const [name, uid, address] of walletDefaults) {
      insertWallet.run(name, uid, address);
    }
  }

  // Insert default TON addresses (V2: with ✅ prefix and new format)
  const tonAddrCount = db.prepare('SELECT COUNT(*) as count FROM ton_addresses').get();
  if (tonAddrCount.count === 0) {
    const tonAddrDefaults = [
      ['✅Tonkeeper', 'UQAQ-F6jfI6m-g05aiOshNRQ_LEImzrxK5T5NAzvhoWPpWRU'],
      ['✅TON Ethereum Network', '0x871968e91042338e4e6673ee42dddced6878bf95'],
      ['✅TON BEB20', '0x871968e91042338e4e6673ee42dddced6878bf95']
    ];
    const insertTonAddr = db.prepare('INSERT INTO ton_addresses (network, address) VALUES (?, ?)');
    for (const [network, address] of tonAddrDefaults) {
      insertTonAddr.run(network, address);
    }
  }

  // Insert default payment info (V2: added APAY)
  const payCount = db.prepare('SELECT COUNT(*) as count FROM payment_info').get();
  if (payCount.count === 0) {
    const payDefaults = [
      ['MIN HTET KYAW', '09258736002', 'KPAY'],
      ['MIN HTET KYAW', '0928736002', 'AYA PAY'],
      ['MIN HTET KYAW', '09754310892', 'WAVE PAY'],
      ['MIN HTET KYAW', '096752628829', 'APAY']
    ];
    const insertPay = db.prepare('INSERT INTO payment_info (name, phone_number, payment_method) VALUES (?, ?, ?)');
    for (const [name, phone, method] of payDefaults) {
      insertPay.run(name, phone, method);
    }
  }

  // Insert default bot settings
  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM bot_settings').get();
  if (settingsCount.count === 0) {
    db.prepare("INSERT INTO bot_settings (key, value) VALUES ('maintenance', 'off')").run();
    db.prepare("INSERT INTO bot_settings (key, value) VALUES ('admin_password', 'admin123')").run();
  }
}

initializeDefaults();

module.exports = db;
