const TelegramBot = require('node-telegram-bot-api');
const db = require('./modules/database');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const BOT_TOKEN = '8635467563:AAE2Cz8IfaLLVp0JGSgKDpm6XaZemtKLN_g';
const ADMIN_ID = '6078445562';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Screenshot directory
const DOWNLOAD_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getUserSession(telegramId) {
  const row = db.prepare('SELECT * FROM user_sessions WHERE telegram_id = ?').get(telegramId);
  if (row && row.temp_data) {
    try { row.temp_data = JSON.parse(row.temp_data); } catch (e) { row.temp_data = {}; }
  }
  return row;
}

function setUserSession(telegramId, flow, step, tempData) {
  const existing = db.prepare('SELECT id FROM user_sessions WHERE telegram_id = ?').get(telegramId);
  if (existing) {
    db.prepare('UPDATE user_sessions SET current_flow = ?, step = ?, temp_data = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?')
      .run(flow, step, JSON.stringify(tempData || {}), telegramId);
  } else {
    db.prepare('INSERT INTO user_sessions (telegram_id, current_flow, step, temp_data) VALUES (?, ?, ?, ?)')
      .run(telegramId, flow, step, JSON.stringify(tempData || {}));
  }
}

function clearUserSession(telegramId) {
  db.prepare('DELETE FROM user_sessions WHERE telegram_id = ?').run(telegramId);
}

function isMaintenance() {
  const row = db.prepare("SELECT value FROM bot_settings WHERE key = 'maintenance'").get();
  return row && row.value === 'on';
}

function isAdmin(telegramId) {
  return String(telegramId) === ADMIN_ID;
}

function registerUser(msg) {
  const telegramId = String(msg.from.id);
  const username = msg.from.username || '';
  const firstName = msg.from.first_name || '';
  const existing = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(telegramId);
  if (existing) {
    db.prepare('UPDATE users SET last_active = CURRENT_TIMESTAMP, telegram_username = ?, telegram_first_name = ? WHERE telegram_id = ?')
      .run(username, firstName, telegramId);
  } else {
    db.prepare('INSERT INTO users (telegram_id, telegram_username, telegram_first_name) VALUES (?, ?, ?)')
      .run(telegramId, username, firstName);
  }
}

function getMainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        ['Tonဝယ်ယူ(သို့)ရန်ရောင်းရန်'],
        ['Crypto Currency ရောင်း(သို့)ဝယ်'],
        ['Telegram Premium (or) Telegram Starဝယ်ယူရန်'],
        ['Telegram Channel Monetizationအကြောင်းအသေးစိတ်စုံစမ်းရန်'],
        ['Chat With AI'],
        ['အခြား(Other)']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

function getPaymentInfoText() {
  const payments = db.prepare('SELECT * FROM payment_info WHERE is_active = 1').all();
  let text = 'ဝယ်ယူမှုပြီးဆုံးရန်အောက်ပါဖုန်းနံပါတ်များသို့ငွေလွှဲပါ\n\n';
  if (payments.length > 0) {
    const name = payments[0].name;
    text += `NAME-${name}\n`;
    for (const p of payments) {
      text += `${p.phone_number}[${p.payment_method}]\n`;
    }
  }
  return text;
}

function getTonAddressesTextForSell() {
  const addrs = db.prepare('SELECT * FROM ton_addresses WHERE is_active = 1').all();
  let text = 'သင်၏လုပ်ဆောင်ချက်ပြီးရန်‌ေအာက်ပါTon addressများသို့Tonလွှဲပါ\n\n';
  for (const a of addrs) {
    text += `${a.network} Adress - ${a.address}\n`;
  }
  return text;
}

function getTonAddressesText() {
  const addrs = db.prepare('SELECT * FROM ton_addresses WHERE is_active = 1').all();
  let text = '';
  for (const a of addrs) {
    text += `${a.network} Adress - ${a.address}\n`;
  }
  return text;
}

function createOrder(telegramId, orderType, category, amount, mmkAmount, extraData) {
  const orderId = 'LXE-' + uuidv4().substring(0, 8).toUpperCase();
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  db.prepare(`INSERT INTO orders (order_id, telegram_id, telegram_username, telegram_first_name, order_type, category, amount, mmk_amount, wallet_address, exchange_name, payment_method, payment_phone, payment_name, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    orderId, telegramId, user?.telegram_username || '', user?.telegram_first_name || '',
    orderType, category, amount, mmkAmount,
    extraData?.wallet_address || null, extraData?.exchange_name || null,
    extraData?.payment_method || null, extraData?.payment_phone || null,
    extraData?.payment_name || null, 'pending'
  );
  return orderId;
}

async function sendOrderToAdmin(orderId, telegramId, screenshotFileId, extraInfo) {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);

  let caption = `📋 *New Order*\n\n`;
  caption += `Order ID: ${orderId}\n`;
  caption += `User: ${user?.telegram_first_name || 'N/A'} (@${user?.telegram_username || 'N/A'})\n`;
  caption += `Telegram ID: ${telegramId}\n`;
  caption += `Type: ${order?.order_type || 'N/A'}\n`;
  caption += `Category: ${order?.category || 'N/A'}\n`;
  if (order?.amount) caption += `Amount: ${order.amount}\n`;
  if (order?.mmk_amount) caption += `MMK: ${order.mmk_amount}\n`;
  if (order?.wallet_address) caption += `Wallet: ${order.wallet_address}\n`;
  if (order?.exchange_name) caption += `Exchange: ${order.exchange_name}\n`;
  if (order?.payment_name) caption += `Payment Name: ${order.payment_name}\n`;
  if (order?.payment_phone) caption += `Payment Phone: ${order.payment_phone}\n`;
  if (order?.payment_method) caption += `Payment Method: ${order.payment_method}\n`;
  if (extraInfo?.payment_raw) caption += `Payment Detail: ${extraInfo.payment_raw}\n`;
  caption += `\nStatus: Pending`;

  const adminButtons = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Confirm', callback_data: `confirm_${orderId}` },
          { text: '❌ Reject', callback_data: `reject_${orderId}` }
        ]
      ]
    }
  };

  try {
    if (screenshotFileId) {
      await bot.sendPhoto(ADMIN_ID, screenshotFileId, { caption, ...adminButtons });
    } else {
      await bot.sendMessage(ADMIN_ID, caption, adminButtons);
    }
  } catch (err) {
    console.error('Error sending to admin:', err);
  }
}

// ============================================================
// /START COMMAND
// ============================================================

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from.id);
  registerUser(msg);

  if (isMaintenance()) {
    bot.sendMessage(chatId, 'Telegram Botအား Maintenanceလုပ်ဆောင်နေပါသည်ယခုအခါယာယီအသုံးမပြုနိုင်သေးပါအကယ်၍Maintenanceပြုလုပ်ပြီးပါကပြန်လည်အကြောင်းကြားပေးပါမည်Luxe Exchangeမိသားစုမှု customerတယောက်ချင်းစီတိုင်းကို\nကျေးဇူးတင်ရှိပါတယ်ခင်ဗျာ');
    return;
  }

  clearUserSession(telegramId);

  const welcomeText = 'Welcome LUXE EXCHANGEမှကြိုဆိုပါတယ်';
  const inlineKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Our Official Channel', url: 'https://t.me/luxeexchangemyanmar' }],
        [{ text: 'Our Official Group', url: 'https://t.me/luxeexchangecommunity' }]
      ]
    }
  };

  bot.sendMessage(chatId, welcomeText, inlineKeyboard).then(() => {
    setTimeout(() => {
      bot.sendMessage(chatId, 'သင်လုပ်ဆောင်လိုသောခလုပ်များကိုနှိုပ်ပါ', getMainMenuKeyboard());
    }, 500);
  });
});

// ============================================================
// /ADMIN COMMAND - MAIN ADMIN PANEL
// ============================================================

bot.onText(/\/admin/, (msg) => {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from.id);

  if (!isAdmin(telegramId)) {
    bot.sendMessage(chatId, '❌ You are not authorized as admin.');
    return;
  }

  clearUserSession(telegramId);
  sendAdminMainMenu(chatId);
});

function sendAdminMainMenu(chatId) {
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const orderCount = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const pendingCount = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;
  const maintStatus = isMaintenance() ? '🛑 ON' : '✅ OFF';

  const text = `🛠️ *LUXE Exchange Admin Panel*\n\n👥 Users: ${userCount}\n📋 Orders: ${orderCount}\n⏳ Pending: ${pendingCount}\n🔧 Maintenance: ${maintStatus}`;

  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📊 Stats', callback_data: 'adm_stats' },
          { text: '🛑 Maintenance', callback_data: 'adm_maintenance' }
        ],
        [
          { text: '💎 TON Prices', callback_data: 'adm_ton_prices' },
          { text: '💲 USDT Prices', callback_data: 'adm_usdt_prices' }
        ],
        [
          { text: '⭐ Star Prices', callback_data: 'adm_star_prices' },
          { text: '👑 Premium Prices', callback_data: 'adm_premium_prices' }
        ],
        [
          { text: '🏦 Exchange Wallets', callback_data: 'adm_wallets' },
          { text: '🔗 TON Addresses', callback_data: 'adm_ton_addrs' }
        ],
        [
          { text: '💳 Payment Info', callback_data: 'adm_payment_info' },
          { text: '📋 Orders', callback_data: 'adm_orders' }
        ],
        [
          { text: '👥 Users', callback_data: 'adm_users' },
          { text: '🏠 Back to Bot', callback_data: 'adm_back_bot' }
        ]
      ]
    }
  });
}

// ============================================================
// ADMIN CALLBACK QUERY HANDLER
// ============================================================

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const telegramId = String(query.from.id);
  const data = query.data;

  // ---- Admin callbacks ----
  if (data.startsWith('adm_')) {
    if (!isAdmin(telegramId)) {
      bot.answerCallbackQuery(query.id, { text: 'Not authorized' });
      return;
    }
    await handleAdminCallback(chatId, telegramId, data, query);
    return;
  }

  // ---- Confirm/Reject order callbacks (admin only) ----
  if (data.startsWith('confirm_') || data.startsWith('reject_')) {
    if (!isAdmin(telegramId)) {
      bot.answerCallbackQuery(query.id, { text: 'Not authorized' });
      return;
    }
    if (data.startsWith('confirm_')) {
      const orderId = data.replace('confirm_', '');
      confirmOrder(orderId, chatId);
      bot.answerCallbackQuery(query.id, { text: '✅ Order confirmed!' });
    } else {
      const orderId = data.replace('reject_', '');
      rejectOrder(orderId, chatId);
      bot.answerCallbackQuery(query.id, { text: '❌ Order rejected!' });
    }
    return;
  }

  // ---- Maintenance check for user callbacks ----
  if (isMaintenance()) {
    bot.answerCallbackQuery(query.id, { text: 'Bot is under maintenance' });
    return;
  }

  // ---- TON Buy Complete (after wallet setup, show payment info) ----
  // IMPORTANT: Exact matches MUST come before prefix matches (ton_buy_)
  if (data === 'ton_buy_complete') {
    const session = getUserSession(telegramId);
    if (!session || session.current_flow !== 'ton_buy') {
      bot.answerCallbackQuery(query.id, { text: 'Session expired' });
      return;
    }
    setUserSession(telegramId, 'ton_buy', 'awaiting_screenshot', session.temp_data || {});

    const payText = getPaymentInfoText();
    bot.sendMessage(chatId, payText, {
      reply_markup: {
        keyboard: [
          ['Payment Completed'],
          ['Main Menu']
        ],
        resize_keyboard: true
      }
    });
    bot.answerCallbackQuery(query.id);
  }
  // ---- TON Sell Complete (after MMK setup, show TON addresses) ----
  else if (data === 'ton_sell_complete') {
    const session = getUserSession(telegramId);
    if (!session || session.current_flow !== 'ton_sell') {
      bot.answerCallbackQuery(query.id, { text: 'Session expired' });
      return;
    }
    setUserSession(telegramId, 'ton_sell', 'awaiting_ton_transfer', session.temp_data || {});

    const addrText = getTonAddressesTextForSell();
    bot.sendMessage(chatId, addrText, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Complete', callback_data: 'ton_sell_transfer_done' }],
          [{ text: 'Main Menu', callback_data: 'main_menu' }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
  }
  // ---- TON Sell Transfer Done (request screenshot) ----
  else if (data === 'ton_sell_transfer_done') {
    const session = getUserSession(telegramId);
    if (!session || session.current_flow !== 'ton_sell') {
      bot.answerCallbackQuery(query.id, { text: 'Session expired' });
      return;
    }
    setUserSession(telegramId, 'ton_sell', 'awaiting_screenshot', session.temp_data || {});

    bot.sendMessage(chatId, 'ငွေလွှဲပြီးကြောင်းပြီးစီးမှု Screenshot ကိုပို့ပေးပါခင်ဗျာ', {
      reply_markup: {
        keyboard: [
          ['Customer Support'],
          ['Main Menu']
        ],
        resize_keyboard: true
      }
    });
    bot.answerCallbackQuery(query.id);
  }
  // ---- TON Setup Wallet Address ----
  else if (data === 'ton_setup_wallet') {
    setUserSession(telegramId, 'ton_buy', 'awaiting_ton_wallet', getUserSession(telegramId)?.temp_data || {});
    bot.sendMessage(chatId, 'ကျေးဇူးပြု၍သင့်၏Ton Wallet Address ကိုပို့ပေးပါ:');
    bot.answerCallbackQuery(query.id);
  }
  // ---- TON Setup MMK Pay ----
  else if (data === 'ton_setup_mmk') {
    setUserSession(telegramId, 'ton_sell', 'awaiting_mmk_pay', getUserSession(telegramId)?.temp_data || {});
    bot.sendMessage(chatId, 'သင့်၏‌ေငွလက်ခံ\nAya Pay Ph No\nKpay Ph No\nWave Pay Ph No\nနှင့်နာမည်ကိုယခုBotကိုပို့ပေးပါ\nဥပမာ-\nMin Htet Kyaw\n09754310892(Wave Money)\n09258736002(Kpay)\nယခုလိုပို့ပေးပါခင်ဗျာ');
    bot.answerCallbackQuery(query.id);
  }
  // ---- TON Buy (V2: Setup wallet address first, then payment) ----
  else if (data.startsWith('ton_buy_')) {
    const priceId = data.replace('ton_buy_', '');
    const price = db.prepare('SELECT * FROM ton_prices WHERE id = ?').get(priceId);
    if (!price) {
      bot.answerCallbackQuery(query.id, { text: 'Error: Price not found' });
      return;
    }

    setUserSession(telegramId, 'ton_buy', 'awaiting_wallet_setup', {
      ton_amount: price.ton_amount, mmk_price: price.mmk_buy_price, price_id: price.id
    });

    bot.sendMessage(chatId, 'ကျေးဇူးပြု၍သင်၏ဝယ်ယူမှုမဆုံးရှုံးစေရန်Ton Wallet Address အားပို့ပေးပါ', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Setup Ton Wallet Address', callback_data: 'ton_setup_wallet' }],
          [{ text: 'Main Menu', callback_data: 'main_menu' }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
  }
  // ---- TON Sell (V2: Setup MMK Pay first, then show TON addresses) ----
  else if (data.startsWith('ton_sell_')) {
    const priceId = data.replace('ton_sell_', '');
    const price = db.prepare('SELECT * FROM ton_prices WHERE id = ?').get(priceId);
    if (!price) {
      bot.answerCallbackQuery(query.id, { text: 'Error: Price not found' });
      return;
    }

    setUserSession(telegramId, 'ton_sell', 'awaiting_mmk_setup', {
      ton_amount: price.ton_amount, mmk_price: price.mmk_sell_price, price_id: price.id
    });

    bot.sendMessage(chatId, 'သင်၏ငွေလက်ခံပေးရန်Setupလုပ်ပါ', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Setup MMK Pay', callback_data: 'ton_setup_mmk' }],
          [{ text: 'Main Menu', callback_data: 'main_menu' }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
  }
  // ---- USDT Buy ----
  else if (data.startsWith('usdt_buy_')) {
    const priceId = data.replace('usdt_buy_', '');
    const price = db.prepare('SELECT * FROM usdt_prices WHERE id = ?').get(priceId);
    if (!price) return;

    setUserSession(telegramId, 'crypto_buy', 'select_exchange', {
      usdt_amount: price.usdt_amount, mmk_price: price.mmk_price, price_id: price.id
    });

    const wallets = db.prepare('SELECT * FROM exchange_wallets WHERE is_active = 1').all();
    const buttons = wallets.map(w => ([{ text: w.name, callback_data: `crypto_buy_exchange_${w.name.replace(/ /g, '_')}` }]));
    buttons.push([{ text: 'Main Menu', callback_data: 'main_menu' }]);
    buttons.push([{ text: 'Customer Support', callback_data: 'customer_support' }]);

    bot.sendMessage(chatId, 'ကျေးဇူးပြု၍သင်ဝယ်ယူလိုသောUSDT Exchange(သို့မဟုတ်)Walletကို‌ေရွးရှယ်ပါ', {
      reply_markup: { inline_keyboard: buttons }
    });
    bot.answerCallbackQuery(query.id);
  }
  // ---- USDT Sell ----
  else if (data.startsWith('usdt_sell_')) {
    const priceId = data.replace('usdt_sell_', '');
    const price = db.prepare('SELECT * FROM usdt_prices WHERE id = ?').get(priceId);
    if (!price) return;

    setUserSession(telegramId, 'crypto_sell', 'setup_usdt_amount', {
      usdt_amount: price.usdt_amount, mmk_price: price.mmk_price, price_id: price.id
    });

    bot.sendMessage(chatId, 'သင်ရောင်းလိုသော USDT amount ကိုSetupလုပ်ပါ', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Setup Sell USDT Amount', callback_data: 'crypto_sell_setup_amount' }],
          [{ text: 'Setup MMK PAY', callback_data: 'crypto_sell_setup_mmk' }],
          [{ text: 'Back Main Menu', callback_data: 'main_menu' }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
  }
  // ---- Crypto Buy Exchange Selection ----
  else if (data.startsWith('crypto_buy_exchange_')) {
    const exchangeName = data.replace('crypto_buy_exchange_', '').replace(/_/g, ' ');
    handleCryptoBuyExchange(chatId, telegramId, exchangeName);
    bot.answerCallbackQuery(query.id);
  }
  // ---- Crypto Setup Address ----
  else if (data === 'crypto_setup_address') {
    setUserSession(telegramId, 'crypto_buy', 'awaiting_wallet_address', getUserSession(telegramId)?.temp_data || {});
    bot.sendMessage(chatId, 'ကျေးဇူးပြု၍သင့်ရဲ့ယာယီWallet or Exchange Adressကိုပေးပို့ပါ');
    bot.answerCallbackQuery(query.id);
  }
  // ---- Crypto Sell Exchange Selection ----
  else if (data.startsWith('crypto_sell_exchange_')) {
    const exchangeName = data.replace('crypto_sell_exchange_', '').replace(/_/g, ' ');
    handleCryptoSellExchange(chatId, telegramId, exchangeName);
    bot.answerCallbackQuery(query.id);
  }
  // ---- Crypto Sell Setup Amount ----
  else if (data === 'crypto_sell_setup_amount') {
    setUserSession(telegramId, 'crypto_sell', 'awaiting_usdt_amount', getUserSession(telegramId)?.temp_data || {});
    bot.sendMessage(chatId, 'သင်ရောင်းလိုသောUSDTပမာဏကိုရိုက်ထည့်ပါ (ဥပမာ: 100)');
    bot.answerCallbackQuery(query.id);
  }
  // ---- Crypto Sell Setup MMK ----
  else if (data === 'crypto_sell_setup_mmk') {
    setUserSession(telegramId, 'crypto_sell', 'awaiting_mmk_pay', getUserSession(telegramId)?.temp_data || {});
    bot.sendMessage(chatId, 'သင့်၏‌ေငွလက်ခံ\nAya Pay Ph No\nKpay Ph No\nWave Pay Ph No\nနှင့်နာမည်ကိုယခုBotကိုပို့ပေးပါ\nဥပမာ-Min Htet Kyaw\n     09754310892(Wave Money)ယခုလိုပို့ပေးပါခင်ဗျာ');
    bot.answerCallbackQuery(query.id);
  }
  // ---- Crypto Sell Complete ----
  else if (data === 'crypto_sell_complete') {
    const session = getUserSession(telegramId);
    if (session) {
      setUserSession(telegramId, 'crypto_sell', 'awaiting_screenshot', session.temp_data || {});
      bot.sendMessage(chatId, 'ကျေးဇူးပြု၍သင်လွှဲပြောင်းထားသော Screenshot ကိုပို့ပေးပါခင်ဗျာ', {
        reply_markup: { keyboard: [['Back Main Menu'], ['Customer Support']], resize_keyboard: true }
      });
    }
    bot.answerCallbackQuery(query.id);
  }
  // ---- Star Buy ----
  else if (data.startsWith('star_buy_')) {
    const priceId = data.replace('star_buy_', '');
    const price = db.prepare('SELECT * FROM star_prices WHERE id = ?').get(priceId);
    if (!price) return;

    setUserSession(telegramId, 'star_buy', 'awaiting_payment', {
      star_amount: price.star_amount, mmk_price: price.mmk_price
    });

    bot.sendMessage(chatId, getPaymentInfoText(), {
      reply_markup: { keyboard: [['Back Main Menu'], ['Complete Payment']], resize_keyboard: true }
    });
    bot.answerCallbackQuery(query.id);
  }
  // ---- Premium Buy ----
  else if (data.startsWith('premium_buy_')) {
    const priceId = data.replace('premium_buy_', '');
    const price = db.prepare('SELECT * FROM premium_prices WHERE id = ?').get(priceId);
    if (!price) return;

    setUserSession(telegramId, 'premium_buy', 'awaiting_payment', {
      duration: price.duration, mmk_price: price.mmk_price
    });

    bot.sendMessage(chatId, getPaymentInfoText(), {
      reply_markup: { keyboard: [['Back Main Menu'], ['Complete Payment']], resize_keyboard: true }
    });
    bot.answerCallbackQuery(query.id);
  }
  // ---- Star Menu ----
  else if (data === 'star_menu') {
    const prices = db.prepare('SELECT * FROM star_prices WHERE is_active = 1').all();
    const buttons = prices.map(p => ([{ text: `${p.star_amount} Stars ${p.mmk_price.toLocaleString()} MMK`, callback_data: `star_buy_${p.id}` }]));
    buttons.push([{ text: 'Back Main Menu', callback_data: 'main_menu' }]);

    bot.sendMessage(chatId, 'Telegram Stars ဝယ်ယူရန်', { reply_markup: { inline_keyboard: buttons } });
    bot.answerCallbackQuery(query.id);
  }
  // ---- Premium Menu ----
  else if (data === 'premium_menu') {
    const prices = db.prepare('SELECT * FROM premium_prices WHERE is_active = 1').all();
    const buttons = prices.map(p => ([{ text: `${p.duration}  ${p.mmk_price.toLocaleString()} MMK`, callback_data: `premium_buy_${p.id}` }]));
    buttons.push([{ text: 'Back Main Menu', callback_data: 'main_menu' }]);

    bot.sendMessage(chatId, 'သင်ဝယ်လိုသောTelegram Premium ကိုရွေးရှယ်ပါ', { reply_markup: { inline_keyboard: buttons } });
    bot.answerCallbackQuery(query.id);
  }
  // ---- Main Menu ----
  else if (data === 'main_menu') {
    clearUserSession(telegramId);
    bot.sendMessage(chatId, 'သင်လုပ်ဆောင်လိုသောခလုပ်များကိုနှိုပ်ပါ', getMainMenuKeyboard());
    bot.answerCallbackQuery(query.id);
  }
  // ---- Customer Support ----
  else if (data === 'customer_support') {
    bot.sendMessage(chatId, 'Customer Support ကိုဆက်သွယ်ရန်', {
      reply_markup: { inline_keyboard: [[{ text: 'Customer Support', url: 'http://t.me/Luxecustomersupport_Bot' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }
});

// ============================================================
// ADMIN CALLBACK HANDLER
// ============================================================

async function handleAdminCallback(chatId, telegramId, data, query) {
  // ---- Admin Stats ----
  if (data === 'adm_stats') {
    const uc = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const oc = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
    const pc = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;
    const cc = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'confirmed'").get().c;
    const rc = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'rejected'").get().c;
    const ms = isMaintenance() ? '🛑 ON' : '✅ OFF';

    bot.sendMessage(chatId, `📊 *Bot Statistics*\n\n👥 Users: ${uc}\n📋 Total Orders: ${oc}\n⏳ Pending: ${pc}\n✅ Confirmed: ${cc}\n❌ Rejected: ${rc}\n🔧 Maintenance: ${ms}`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Admin Menu', callback_data: 'adm_back' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }
  // ---- Maintenance Toggle ----
  else if (data === 'adm_maintenance') {
    const current = db.prepare("SELECT value FROM bot_settings WHERE key = 'maintenance'").get();
    const newVal = current.value === 'on' ? 'off' : 'on';
    db.prepare("UPDATE bot_settings SET value = ? WHERE key = 'maintenance'").run(newVal);

    const statusText = newVal === 'on' ? '🛑 Maintenance ON - Bot Stopped' : '✅ Maintenance OFF - Bot Running';
    bot.sendMessage(chatId, statusText, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Admin Menu', callback_data: 'adm_back' }]] }
    });
    bot.answerCallbackQuery(query.id, { text: newVal === 'on' ? 'Maintenance ON' : 'Maintenance OFF' });
  }
  // ---- Back to Admin Menu ----
  else if (data === 'adm_back') {
    sendAdminMainMenu(chatId);
    bot.answerCallbackQuery(query.id);
  }
  // ---- Back to Bot ----
  else if (data === 'adm_back_bot') {
    clearUserSession(telegramId);
    bot.sendMessage(chatId, 'သင်လုပ်ဆောင်လိုသောခလုပ်များကိုနှိုပ်ပါ', getMainMenuKeyboard());
    bot.answerCallbackQuery(query.id);
  }

  // ==== TON PRICES ====
  else if (data === 'adm_ton_prices') {
    const prices = db.prepare('SELECT * FROM ton_prices ORDER BY ton_amount ASC').all();
    let text = '💎 *TON Prices (V2)*\n\n🟢 Buy | 🔴 Sell\n\n';
    const buttons = [];
    for (const p of prices) {
      text += `${p.ton_amount} TON → 🟢${(p.mmk_buy_price || 0).toLocaleString()} MMK | 🔴${(p.mmk_sell_price || 0).toLocaleString()} MMK ${p.is_active ? '✅' : '❌'}\n`;
      buttons.push([{ text: `✏️ ${p.ton_amount}TON Buy:${p.mmk_buy_price} Sell:${p.mmk_sell_price}`, callback_data: `adm_ton_edit_${p.id}` }]);
    }
    buttons.push([{ text: '➕ Add TON Price', callback_data: 'adm_ton_add' }]);
    buttons.push([{ text: '🔙 Admin Menu', callback_data: 'adm_back' }]);

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'adm_ton_add') {
    setUserSession(telegramId, 'admin_edit', 'awaiting_ton_amount', { action: 'add' });
    bot.sendMessage(chatId, '➕ Add TON Price\n\nEnter TON amount (e.g. 0.3):');
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_ton_edit_')) {
    const id = data.replace('adm_ton_edit_', '');
    const price = db.prepare('SELECT * FROM ton_prices WHERE id = ?').get(id);
    if (!price) return;
    bot.sendMessage(chatId, `💎 *TON Price* - ${price.ton_amount} TON\n🟢 Buy: ${(price.mmk_buy_price || 0).toLocaleString()} MMK\n🔴 Sell: ${(price.mmk_sell_price || 0).toLocaleString()} MMK\nStatus: ${price.is_active ? 'Active ✅' : 'Inactive ❌'}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✏️ Edit Buy Price', callback_data: `adm_ton_editbuy_${id}` },
            { text: '✏️ Edit Sell Price', callback_data: `adm_ton_editsell_${id}` }
          ],
          [
            { text: price.is_active ? '❌ Deactivate' : '✅ Activate', callback_data: `adm_ton_toggle_${id}` },
            { text: '🗑️ Delete', callback_data: `adm_ton_delete_${id}` }
          ],
          [{ text: '🔙 TON Prices', callback_data: 'adm_ton_prices' }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_ton_editbuy_')) {
    const id = data.replace('adm_ton_editbuy_', '');
    const price = db.prepare('SELECT * FROM ton_prices WHERE id = ?').get(id);
    setUserSession(telegramId, 'admin_edit', 'awaiting_ton_buy_price_edit', { action: 'edit', id: id, current: price });
    bot.sendMessage(chatId, `Enter new Buy price (current: ${price.mmk_buy_price || 0} MMK):`);
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_ton_editsell_')) {
    const id = data.replace('adm_ton_editsell_', '');
    const price = db.prepare('SELECT * FROM ton_prices WHERE id = ?').get(id);
    setUserSession(telegramId, 'admin_edit', 'awaiting_ton_sell_price_edit', { action: 'edit', id: id, current: price });
    bot.sendMessage(chatId, `Enter new Sell price (current: ${price.mmk_sell_price || 0} MMK):`);
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_ton_toggle_')) {
    const id = data.replace('adm_ton_toggle_', '');
    const price = db.prepare('SELECT * FROM ton_prices WHERE id = ?').get(id);
    const newStatus = price.is_active ? 0 : 1;
    db.prepare('UPDATE ton_prices SET is_active = ? WHERE id = ?').run(newStatus, id);
    bot.sendMessage(chatId, `${newStatus ? '✅ Activated' : '❌ Deactivated'}: ${price.ton_amount} TON`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 TON Prices', callback_data: 'adm_ton_prices' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_ton_delete_')) {
    const id = data.replace('adm_ton_delete_', '');
    const price = db.prepare('SELECT * FROM ton_prices WHERE id = ?').get(id);
    db.prepare('DELETE FROM ton_prices WHERE id = ?').run(id);
    bot.sendMessage(chatId, `🗑️ Deleted: ${price.ton_amount} TON`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 TON Prices', callback_data: 'adm_ton_prices' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }

  // ==== USDT PRICES ====
  else if (data === 'adm_usdt_prices') {
    const prices = db.prepare('SELECT * FROM usdt_prices ORDER BY usdt_amount ASC').all();
    let text = '💲 *USDT Prices*\n\n';
    const buttons = [];
    for (const p of prices) {
      text += `${p.usdt_amount} USDT → ${p.mmk_price.toLocaleString()} MMK ${p.is_active ? '✅' : '❌'}\n`;
      buttons.push([{ text: `✏️ ${p.usdt_amount}USDT - ${p.mmk_price}MMK`, callback_data: `adm_usdt_edit_${p.id}` }]);
    }
    buttons.push([{ text: '➕ Add USDT Price', callback_data: 'adm_usdt_add' }]);
    buttons.push([{ text: '🔙 Admin Menu', callback_data: 'adm_back' }]);

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'adm_usdt_add') {
    setUserSession(telegramId, 'admin_edit', 'awaiting_usdt_amount', { action: 'add' });
    bot.sendMessage(chatId, '➕ Add USDT Price\n\nEnter USDT amount (e.g. 1):');
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_usdt_edit_')) {
    const id = data.replace('adm_usdt_edit_', '');
    const price = db.prepare('SELECT * FROM usdt_prices WHERE id = ?').get(id);
    if (!price) return;
    bot.sendMessage(chatId, `💲 *USDT Price* - ${price.usdt_amount} USDT = ${price.mmk_price} MMK\nStatus: ${price.is_active ? 'Active ✅' : 'Inactive ❌'}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✏️ Edit Price', callback_data: `adm_usdt_editprice_${id}` },
            { text: price.is_active ? '❌ Deactivate' : '✅ Activate', callback_data: `adm_usdt_toggle_${id}` }
          ],
          [{ text: '🗑️ Delete', callback_data: `adm_usdt_delete_${id}` }],
          [{ text: '🔙 USDT Prices', callback_data: 'adm_usdt_prices' }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_usdt_editprice_')) {
    const id = data.replace('adm_usdt_editprice_', '');
    const price = db.prepare('SELECT * FROM usdt_prices WHERE id = ?').get(id);
    setUserSession(telegramId, 'admin_edit', 'awaiting_usdt_amount', { action: 'edit', id: id, current: price });
    bot.sendMessage(chatId, `Enter new USDT amount (current: ${price.usdt_amount}):`);
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_usdt_toggle_')) {
    const id = data.replace('adm_usdt_toggle_', '');
    const price = db.prepare('SELECT * FROM usdt_prices WHERE id = ?').get(id);
    const newStatus = price.is_active ? 0 : 1;
    db.prepare('UPDATE usdt_prices SET is_active = ? WHERE id = ?').run(newStatus, id);
    bot.sendMessage(chatId, `${newStatus ? '✅ Activated' : '❌ Deactivated'}: ${price.usdt_amount} USDT`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 USDT Prices', callback_data: 'adm_usdt_prices' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_usdt_delete_')) {
    const id = data.replace('adm_usdt_delete_', '');
    const price = db.prepare('SELECT * FROM usdt_prices WHERE id = ?').get(id);
    db.prepare('DELETE FROM usdt_prices WHERE id = ?').run(id);
    bot.sendMessage(chatId, `🗑️ Deleted: ${price.usdt_amount} USDT`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 USDT Prices', callback_data: 'adm_usdt_prices' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }

  // ==== STAR PRICES ====
  else if (data === 'adm_star_prices') {
    const prices = db.prepare('SELECT * FROM star_prices ORDER BY star_amount ASC').all();
    let text = '⭐ *Telegram Star Prices*\n\n';
    const buttons = [];
    for (const p of prices) {
      text += `${p.star_amount} Stars → ${p.mmk_price.toLocaleString()} MMK ${p.is_active ? '✅' : '❌'}\n`;
      buttons.push([{ text: `✏️ ${p.star_amount}Stars - ${p.mmk_price}MMK`, callback_data: `adm_star_edit_${p.id}` }]);
    }
    buttons.push([{ text: '➕ Add Star Price', callback_data: 'adm_star_add' }]);
    buttons.push([{ text: '🔙 Admin Menu', callback_data: 'adm_back' }]);

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'adm_star_add') {
    setUserSession(telegramId, 'admin_edit', 'awaiting_star_amount', { action: 'add' });
    bot.sendMessage(chatId, '➕ Add Star Price\n\nEnter Stars amount (e.g. 50):');
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_star_edit_')) {
    const id = data.replace('adm_star_edit_', '');
    const price = db.prepare('SELECT * FROM star_prices WHERE id = ?').get(id);
    if (!price) return;
    bot.sendMessage(chatId, `⭐ *Star Price* - ${price.star_amount} Stars = ${price.mmk_price} MMK\nStatus: ${price.is_active ? 'Active ✅' : 'Inactive ❌'}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✏️ Edit Price', callback_data: `adm_star_editprice_${id}` },
            { text: price.is_active ? '❌ Deactivate' : '✅ Activate', callback_data: `adm_star_toggle_${id}` }
          ],
          [{ text: '🗑️ Delete', callback_data: `adm_star_delete_${id}` }],
          [{ text: '🔙 Star Prices', callback_data: 'adm_star_prices' }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_star_editprice_')) {
    const id = data.replace('adm_star_editprice_', '');
    const price = db.prepare('SELECT * FROM star_prices WHERE id = ?').get(id);
    setUserSession(telegramId, 'admin_edit', 'awaiting_star_amount', { action: 'edit', id: id, current: price });
    bot.sendMessage(chatId, `Enter new Stars amount (current: ${price.star_amount}):`);
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_star_toggle_')) {
    const id = data.replace('adm_star_toggle_', '');
    const price = db.prepare('SELECT * FROM star_prices WHERE id = ?').get(id);
    const newStatus = price.is_active ? 0 : 1;
    db.prepare('UPDATE star_prices SET is_active = ? WHERE id = ?').run(newStatus, id);
    bot.sendMessage(chatId, `${newStatus ? '✅ Activated' : '❌ Deactivated'}: ${price.star_amount} Stars`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Star Prices', callback_data: 'adm_star_prices' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_star_delete_')) {
    const id = data.replace('adm_star_delete_', '');
    const price = db.prepare('SELECT * FROM star_prices WHERE id = ?').get(id);
    db.prepare('DELETE FROM star_prices WHERE id = ?').run(id);
    bot.sendMessage(chatId, `🗑️ Deleted: ${price.star_amount} Stars`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Star Prices', callback_data: 'adm_star_prices' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }

  // ==== PREMIUM PRICES ====
  else if (data === 'adm_premium_prices') {
    const prices = db.prepare('SELECT * FROM premium_prices ORDER BY id ASC').all();
    let text = '👑 *Telegram Premium Prices*\n\n';
    const buttons = [];
    for (const p of prices) {
      text += `${p.duration} → ${p.mmk_price.toLocaleString()} MMK ${p.is_active ? '✅' : '❌'}\n`;
      buttons.push([{ text: `✏️ ${p.duration} - ${p.mmk_price}MMK`, callback_data: `adm_prem_edit_${p.id}` }]);
    }
    buttons.push([{ text: '➕ Add Premium Price', callback_data: 'adm_prem_add' }]);
    buttons.push([{ text: '🔙 Admin Menu', callback_data: 'adm_back' }]);

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'adm_prem_add') {
    setUserSession(telegramId, 'admin_edit', 'awaiting_prem_duration', { action: 'add' });
    bot.sendMessage(chatId, '➕ Add Premium Price\n\nEnter duration (e.g. 1 Year (၁နှစ်)):');
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_prem_edit_')) {
    const id = data.replace('adm_prem_edit_', '');
    const price = db.prepare('SELECT * FROM premium_prices WHERE id = ?').get(id);
    if (!price) return;
    bot.sendMessage(chatId, `👑 *Premium* - ${price.duration} = ${price.mmk_price} MMK\nStatus: ${price.is_active ? 'Active ✅' : 'Inactive ❌'}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✏️ Edit', callback_data: `adm_prem_editprice_${id}` },
            { text: price.is_active ? '❌ Deactivate' : '✅ Activate', callback_data: `adm_prem_toggle_${id}` }
          ],
          [{ text: '🗑️ Delete', callback_data: `adm_prem_delete_${id}` }],
          [{ text: '🔙 Premium Prices', callback_data: 'adm_premium_prices' }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_prem_editprice_')) {
    const id = data.replace('adm_prem_editprice_', '');
    const price = db.prepare('SELECT * FROM premium_prices WHERE id = ?').get(id);
    setUserSession(telegramId, 'admin_edit', 'awaiting_prem_duration', { action: 'edit', id: id, current: price });
    bot.sendMessage(chatId, `Enter new duration (current: ${price.duration}):`);
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_prem_toggle_')) {
    const id = data.replace('adm_prem_toggle_', '');
    const price = db.prepare('SELECT * FROM premium_prices WHERE id = ?').get(id);
    const newStatus = price.is_active ? 0 : 1;
    db.prepare('UPDATE premium_prices SET is_active = ? WHERE id = ?').run(newStatus, id);
    bot.sendMessage(chatId, `${newStatus ? '✅ Activated' : '❌ Deactivated'}: ${price.duration}`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Premium Prices', callback_data: 'adm_premium_prices' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_prem_delete_')) {
    const id = data.replace('adm_prem_delete_', '');
    const price = db.prepare('SELECT * FROM premium_prices WHERE id = ?').get(id);
    db.prepare('DELETE FROM premium_prices WHERE id = ?').run(id);
    bot.sendMessage(chatId, `🗑️ Deleted: ${price.duration}`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Premium Prices', callback_data: 'adm_premium_prices' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }

  // ==== EXCHANGE WALLETS ====
  else if (data === 'adm_wallets') {
    const wallets = db.prepare('SELECT * FROM exchange_wallets ORDER BY id ASC').all();
    let text = '🏦 *Exchange Wallets*\n\n';
    const buttons = [];
    for (const w of wallets) {
      text += `${w.name} ${w.is_active ? '✅' : '❌'}\n`;
      if (w.uid) text += `  UID: ${w.uid}\n`;
      if (w.address) text += `  Addr: ${w.address.substring(0, 20)}...\n`;
      buttons.push([{ text: `✏️ ${w.name}`, callback_data: `adm_wallet_edit_${w.id}` }]);
    }
    buttons.push([{ text: '➕ Add Wallet', callback_data: 'adm_wallet_add' }]);
    buttons.push([{ text: '🔙 Admin Menu', callback_data: 'adm_back' }]);

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'adm_wallet_add') {
    setUserSession(telegramId, 'admin_edit', 'awaiting_wallet_name', { action: 'add' });
    bot.sendMessage(chatId, '➕ Add Wallet\n\nEnter wallet/exchange name:');
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_wallet_edit_')) {
    const id = data.replace('adm_wallet_edit_', '');
    const wallet = db.prepare('SELECT * FROM exchange_wallets WHERE id = ?').get(id);
    if (!wallet) return;
    bot.sendMessage(chatId, `🏦 *${wallet.name}*\nUID: ${wallet.uid || 'N/A'}\nAddress: ${wallet.address || 'N/A'}\nStatus: ${wallet.is_active ? 'Active ✅' : 'Inactive ❌'}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✏️ Edit Name', callback_data: `adm_wallet_editname_${id}` },
            { text: '📝 Edit UID', callback_data: `adm_wallet_edituid_${id}` }
          ],
          [
            { text: '📝 Edit Address', callback_data: `adm_wallet_editaddr_${id}` },
            { text: wallet.is_active ? '❌ Deactivate' : '✅ Activate', callback_data: `adm_wallet_toggle_${id}` }
          ],
          [{ text: '🗑️ Delete', callback_data: `adm_wallet_delete_${id}` }],
          [{ text: '🔙 Wallets', callback_data: 'adm_wallets' }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_wallet_editname_')) {
    const id = data.replace('adm_wallet_editname_', '');
    const wallet = db.prepare('SELECT * FROM exchange_wallets WHERE id = ?').get(id);
    setUserSession(telegramId, 'admin_edit', 'awaiting_wallet_name', { action: 'edit', id, field: 'name' });
    bot.sendMessage(chatId, `Enter new name (current: ${wallet.name}):`);
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_wallet_edituid_')) {
    const id = data.replace('adm_wallet_edituid_', '');
    const wallet = db.prepare('SELECT * FROM exchange_wallets WHERE id = ?').get(id);
    setUserSession(telegramId, 'admin_edit', 'awaiting_wallet_uid', { action: 'edit', id });
    bot.sendMessage(chatId, `Enter new UID (current: ${wallet.uid || 'N/A'}):`);
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_wallet_editaddr_')) {
    const id = data.replace('adm_wallet_editaddr_', '');
    const wallet = db.prepare('SELECT * FROM exchange_wallets WHERE id = ?').get(id);
    setUserSession(telegramId, 'admin_edit', 'awaiting_wallet_address', { action: 'edit', id });
    bot.sendMessage(chatId, `Enter new Address (current: ${wallet.address || 'N/A'}):`);
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_wallet_toggle_')) {
    const id = data.replace('adm_wallet_toggle_', '');
    const wallet = db.prepare('SELECT * FROM exchange_wallets WHERE id = ?').get(id);
    const newStatus = wallet.is_active ? 0 : 1;
    db.prepare('UPDATE exchange_wallets SET is_active = ? WHERE id = ?').run(newStatus, id);
    bot.sendMessage(chatId, `${newStatus ? '✅ Activated' : '❌ Deactivated'}: ${wallet.name}`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Wallets', callback_data: 'adm_wallets' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_wallet_delete_')) {
    const id = data.replace('adm_wallet_delete_', '');
    const wallet = db.prepare('SELECT * FROM exchange_wallets WHERE id = ?').get(id);
    db.prepare('DELETE FROM exchange_wallets WHERE id = ?').run(id);
    bot.sendMessage(chatId, `🗑️ Deleted: ${wallet.name}`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Wallets', callback_data: 'adm_wallets' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }

  // ==== TON ADDRESSES ====
  else if (data === 'adm_ton_addrs') {
    const addrs = db.prepare('SELECT * FROM ton_addresses ORDER BY id ASC').all();
    let text = '🔗 *TON Addresses*\n\n';
    const buttons = [];
    for (const a of addrs) {
      text += `${a.network}: ${a.address.substring(0, 25)}... ${a.is_active ? '✅' : '❌'}\n`;
      buttons.push([{ text: `✏️ ${a.network}`, callback_data: `adm_taddr_edit_${a.id}` }]);
    }
    buttons.push([{ text: '➕ Add Address', callback_data: 'adm_taddr_add' }]);
    buttons.push([{ text: '🔙 Admin Menu', callback_data: 'adm_back' }]);

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'adm_taddr_add') {
    setUserSession(telegramId, 'admin_edit', 'awaiting_tonaddr_network', { action: 'add' });
    bot.sendMessage(chatId, '➕ Add TON Address\n\nEnter network name (e.g. TON Network):');
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_taddr_edit_')) {
    const id = data.replace('adm_taddr_edit_', '');
    const addr = db.prepare('SELECT * FROM ton_addresses WHERE id = ?').get(id);
    if (!addr) return;
    bot.sendMessage(chatId, `🔗 *${addr.network}*\nAddress: \`${addr.address}\`\nStatus: ${addr.is_active ? 'Active ✅' : 'Inactive ❌'}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📝 Edit Network', callback_data: `adm_taddr_editnet_${id}` },
            { text: '📝 Edit Address', callback_data: `adm_taddr_editaddr_${id}` }
          ],
          [
            { text: addr.is_active ? '❌ Deactivate' : '✅ Activate', callback_data: `adm_taddr_toggle_${id}` },
            { text: '🗑️ Delete', callback_data: `adm_taddr_delete_${id}` }
          ],
          [{ text: '🔙 TON Addresses', callback_data: 'adm_ton_addrs' }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_taddr_editnet_')) {
    const id = data.replace('adm_taddr_editnet_', '');
    const addr = db.prepare('SELECT * FROM ton_addresses WHERE id = ?').get(id);
    setUserSession(telegramId, 'admin_edit', 'awaiting_tonaddr_network', { action: 'edit', id });
    bot.sendMessage(chatId, `Enter new network name (current: ${addr.network}):`);
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_taddr_editaddr_')) {
    const id = data.replace('adm_taddr_editaddr_', '');
    const addr = db.prepare('SELECT * FROM ton_addresses WHERE id = ?').get(id);
    setUserSession(telegramId, 'admin_edit', 'awaiting_tonaddr_address', { action: 'edit', id });
    bot.sendMessage(chatId, `Enter new address (current: ${addr.address}):`);
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_taddr_toggle_')) {
    const id = data.replace('adm_taddr_toggle_', '');
    const addr = db.prepare('SELECT * FROM ton_addresses WHERE id = ?').get(id);
    const newStatus = addr.is_active ? 0 : 1;
    db.prepare('UPDATE ton_addresses SET is_active = ? WHERE id = ?').run(newStatus, id);
    bot.sendMessage(chatId, `${newStatus ? '✅ Activated' : '❌ Deactivated'}: ${addr.network}`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 TON Addresses', callback_data: 'adm_ton_addrs' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_taddr_delete_')) {
    const id = data.replace('adm_taddr_delete_', '');
    const addr = db.prepare('SELECT * FROM ton_addresses WHERE id = ?').get(id);
    db.prepare('DELETE FROM ton_addresses WHERE id = ?').run(id);
    bot.sendMessage(chatId, `🗑️ Deleted: ${addr.network}`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 TON Addresses', callback_data: 'adm_ton_addrs' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }

  // ==== PAYMENT INFO ====
  else if (data === 'adm_payment_info') {
    const infos = db.prepare('SELECT * FROM payment_info ORDER BY id ASC').all();
    let text = '💳 *Payment Info*\n\n';
    const buttons = [];
    for (const p of infos) {
      text += `${p.name} - ${p.phone_number} [${p.payment_method}] ${p.is_active ? '✅' : '❌'}\n`;
      buttons.push([{ text: `✏️ ${p.phone_number} [${p.payment_method}]`, callback_data: `adm_pay_edit_${p.id}` }]);
    }
    buttons.push([{ text: '➕ Add Payment', callback_data: 'adm_pay_add' }]);
    buttons.push([{ text: '🔙 Admin Menu', callback_data: 'adm_back' }]);

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    bot.answerCallbackQuery(query.id);
  }
  else if (data === 'adm_pay_add') {
    setUserSession(telegramId, 'admin_edit', 'awaiting_pay_name', { action: 'add' });
    bot.sendMessage(chatId, '➕ Add Payment\n\nEnter name (e.g. MIN HTET KYAW):');
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_pay_edit_')) {
    const id = data.replace('adm_pay_edit_', '');
    const pay = db.prepare('SELECT * FROM payment_info WHERE id = ?').get(id);
    if (!pay) return;
    bot.sendMessage(chatId, `💳 *${pay.name}*\nPhone: ${pay.phone_number}\nMethod: ${pay.payment_method}\nStatus: ${pay.is_active ? 'Active ✅' : 'Inactive ❌'}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📝 Edit Name', callback_data: `adm_pay_editname_${id}` },
            { text: '📝 Edit Phone', callback_data: `adm_pay_editphone_${id}` }
          ],
          [
            { text: '📝 Edit Method', callback_data: `adm_pay_editmethod_${id}` },
            { text: pay.is_active ? '❌ Deactivate' : '✅ Activate', callback_data: `adm_pay_toggle_${id}` }
          ],
          [{ text: '🗑️ Delete', callback_data: `adm_pay_delete_${id}` }],
          [{ text: '🔙 Payment Info', callback_data: 'adm_payment_info' }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_pay_editname_')) {
    const id = data.replace('adm_pay_editname_', '');
    const pay = db.prepare('SELECT * FROM payment_info WHERE id = ?').get(id);
    setUserSession(telegramId, 'admin_edit', 'awaiting_pay_name', { action: 'edit', id });
    bot.sendMessage(chatId, `Enter new name (current: ${pay.name}):`);
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_pay_editphone_')) {
    const id = data.replace('adm_pay_editphone_', '');
    const pay = db.prepare('SELECT * FROM payment_info WHERE id = ?').get(id);
    setUserSession(telegramId, 'admin_edit', 'awaiting_pay_phone', { action: 'edit', id });
    bot.sendMessage(chatId, `Enter new phone (current: ${pay.phone_number}):`);
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_pay_editmethod_')) {
    const id = data.replace('adm_pay_editmethod_', '');
    const pay = db.prepare('SELECT * FROM payment_info WHERE id = ?').get(id);
    setUserSession(telegramId, 'admin_edit', 'awaiting_pay_method', { action: 'edit', id });
    bot.sendMessage(chatId, `Enter new method (current: ${pay.payment_method}):`);
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_pay_toggle_')) {
    const id = data.replace('adm_pay_toggle_', '');
    const pay = db.prepare('SELECT * FROM payment_info WHERE id = ?').get(id);
    const newStatus = pay.is_active ? 0 : 1;
    db.prepare('UPDATE payment_info SET is_active = ? WHERE id = ?').run(newStatus, id);
    bot.sendMessage(chatId, `${newStatus ? '✅ Activated' : '❌ Deactivated'}: ${pay.phone_number}`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Payment Info', callback_data: 'adm_payment_info' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_pay_delete_')) {
    const id = data.replace('adm_pay_delete_', '');
    const pay = db.prepare('SELECT * FROM payment_info WHERE id = ?').get(id);
    db.prepare('DELETE FROM payment_info WHERE id = ?').run(id);
    bot.sendMessage(chatId, `🗑️ Deleted: ${pay.phone_number}`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Payment Info', callback_data: 'adm_payment_info' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }

  // ==== ORDERS ====
  else if (data === 'adm_orders') {
    bot.sendMessage(chatId, '📋 *Orders Management*', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⏳ Pending Orders', callback_data: 'adm_orders_pending' }],
          [{ text: '✅ Confirmed Orders', callback_data: 'adm_orders_confirmed' }],
          [{ text: '❌ Rejected Orders', callback_data: 'adm_orders_rejected' }],
          [{ text: '🔙 Admin Menu', callback_data: 'adm_back' }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
  }
  else if (data.startsWith('adm_orders_')) {
    const status = data.replace('adm_orders_', '');
    const orders = db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT 10').all(status);
    if (orders.length === 0) {
      bot.sendMessage(chatId, `No ${status} orders found.`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Orders', callback_data: 'adm_orders' }]] }
      });
    } else {
      for (const o of orders) {
        let caption = `📋 *Order ${o.order_id}*\n`;
        caption += `User: ${o.telegram_first_name} (@${o.telegram_username || 'N/A'})\n`;
        caption += `Telegram ID: ${o.telegram_id}\n`;
        caption += `Type: ${o.order_type}\n`;
        caption += `Category: ${o.category}\n`;
        if (o.amount) caption += `Amount: ${o.amount}\n`;
        if (o.mmk_amount) caption += `MMK: ${Number(o.mmk_amount).toLocaleString()}\n`;
        if (o.wallet_address) caption += `Wallet: ${o.wallet_address}\n`;
        if (o.exchange_name) caption += `Exchange: ${o.exchange_name}\n`;
        if (o.payment_name) caption += `Payment Name: ${o.payment_name}\n`;
        if (o.payment_phone) caption += `Payment Phone: ${o.payment_phone}\n`;
        if (o.payment_method) caption += `Payment Method: ${o.payment_method}\n`;
        caption += `Status: ${o.status}\n`;
        caption += `Date: ${new Date(o.created_at).toLocaleString()}`;

        const buttons = [];
        if (status === 'pending') {
          buttons.push([
            { text: '✅ Confirm', callback_data: `confirm_${o.order_id}` },
            { text: '❌ Reject', callback_data: `reject_${o.order_id}` }
          ]);
        }
        buttons.push([{ text: '🔙 Orders', callback_data: 'adm_orders' }]);

        const replyMarkup = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };

        // Send screenshot with order details as caption if available
        if (o.screenshot_file_id) {
          try {
            await bot.sendPhoto(chatId, o.screenshot_file_id, { caption, ...replyMarkup });
          } catch (e) {
            console.error('[ADMIN] Error sending screenshot for order:', o.order_id, e.message);
            // Fallback to text-only if photo fails
            bot.sendMessage(chatId, caption, replyMarkup);
          }
        } else {
          bot.sendMessage(chatId, caption, replyMarkup);
        }
      }
    }
    bot.answerCallbackQuery(query.id);
  }

  // ==== USERS ====
  else if (data === 'adm_users') {
    const users = db.prepare('SELECT * FROM users ORDER BY last_active DESC LIMIT 20').all();
    let text = `👥 *Users* (Last 20)\n\n`;
    for (const u of users) {
      text += `${u.telegram_first_name || 'N/A'} (@${u.telegram_username || 'N/A'})\n`;
      text += `ID: ${u.telegram_id} | Last: ${new Date(u.last_active).toLocaleDateString()}\n\n`;
    }
    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Admin Menu', callback_data: 'adm_back' }]] }
    });
    bot.answerCallbackQuery(query.id);
  }

}

// ============================================================
// MESSAGE HANDLER
// ============================================================

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from.id);
  const text = msg.text;

  // Handle photo messages (screenshots)
  if (msg.photo) {
    if (isMaintenance() && !isAdmin(telegramId)) return;
    handleScreenshot(msg);
    return;
  }

  if (!text) return;
  if (text.startsWith('/')) return; // Skip commands

  // ---- Admin edit flow handler ----
  const session = getUserSession(telegramId);
  if (session && session.current_flow === 'admin_edit' && isAdmin(telegramId)) {
    handleAdminEditFlow(chatId, telegramId, text, session);
    return;
  }

  if (isMaintenance() && !isAdmin(telegramId)) {
    bot.sendMessage(chatId, 'Telegram Botအား Maintenanceလုပ်ဆောင်နေပါသည်ယခုအခါယာယီအသုံးမပြုနိုင်သေးပါ');
    return;
  }

  registerUser(msg);

  // Handle main menu buttons
  if (text === 'Tonဝယ်ယူ(သို့)ရန်ရောင်းရန်') {
    handleTonMenu(chatId, telegramId);
  } else if (text === 'Crypto Currency ရောင်း(သို့)ဝယ်') {
    handleCryptoMenu(chatId, telegramId);
  } else if (text === 'Telegram Premium (or) Telegram Starဝယ်ယူရန်') {
    handlePremiumStarMenu(chatId, telegramId);
  } else if (text === 'Telegram Channel Monetizationအကြောင်းအသေးစိတ်စုံစမ်းရန်') {
    handleMonetizationMenu(chatId, telegramId);
  } else if (text === 'Chat With AI') {
    handleAiChat(chatId, telegramId, msg);
  } else if (text === 'အခြား(Other)') {
    handleOtherMenu(chatId, telegramId);
  } else if (text === 'Main Menu' || text === 'Back Main Menu' || text === 'back main menu') {
    clearUserSession(telegramId);
    bot.sendMessage(chatId, 'သင်လုပ်ဆောင်လိုသောခလုပ်များကိုနှိုပ်ပါ', getMainMenuKeyboard());
  } else if (text === 'Customer Support') {
    bot.sendMessage(chatId, 'Customer Support ကိုဆက်သွယ်ရန် အောက်ပါ Bot ကိုနှိုပ်ပါ', {
      reply_markup: { inline_keyboard: [[{ text: 'Customer Support', url: 'http://t.me/Luxecustomersupport_Bot' }]] }
    });
  } else if (text === 'Payment completed' || text === 'Payment Completed' || text === 'Completed Payment' || text === 'Complete Payment' || text === 'Complete ✅') {
    const sess = getUserSession(telegramId);
    if (!sess) return;
    // Set session step to awaiting_screenshot so screenshot handler works
    if (sess.current_flow === 'ton_buy' || sess.current_flow === 'ton_sell' ||
        sess.current_flow === 'crypto_buy' || sess.current_flow === 'crypto_sell' ||
        sess.current_flow === 'star_buy' || sess.current_flow === 'premium_buy') {
      setUserSession(telegramId, sess.current_flow, 'awaiting_screenshot', sess.temp_data || {});
    }
    bot.sendMessage(chatId, 'ငွေချေမှုပြီးမြောက်ပါကသင်၏ငွေချေမှုပြီးမြောက်ကြောင်းSlipအားပို့ပေးပါ။', {
      reply_markup: { keyboard: [['Customer Support'], ['Main Menu']], resize_keyboard: true }
    });
  } else {
    handleSessionMessage(chatId, telegramId, text, msg);
  }
});

// ============================================================
// ADMIN EDIT FLOW HANDLER (handles text input for add/edit)
// ============================================================

function handleAdminEditFlow(chatId, telegramId, text, session) {
  const step = session.step;
  const tempData = session.temp_data || {};
  const action = tempData.action; // 'add' or 'edit'

  // ---- TON Price (V2: separate buy/sell) ----
  if (step === 'awaiting_ton_amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, '❌ Invalid amount. Enter a valid number:');
      return;
    }
    tempData.ton_amount = amount;
    setUserSession(telegramId, 'admin_edit', 'awaiting_ton_buy_price', tempData);
    const currentBuy = tempData.current ? (tempData.current.mmk_buy_price || 0) : '';
    bot.sendMessage(chatId, `Enter Buy price in MMK${currentBuy ? ` (current: ${currentBuy})` : ''}:`);
  }
  else if (step === 'awaiting_ton_buy_price') {
    const mmk = parseFloat(text);
    if (isNaN(mmk) || mmk <= 0) {
      bot.sendMessage(chatId, '❌ Invalid price. Enter a valid number:');
      return;
    }
    tempData.mmk_buy_price = mmk;
    setUserSession(telegramId, 'admin_edit', 'awaiting_ton_sell_price', tempData);
    const currentSell = tempData.current ? (tempData.current.mmk_sell_price || 0) : '';
    bot.sendMessage(chatId, `Enter Sell price in MMK${currentSell ? ` (current: ${currentSell})` : ''}:`);
  }
  else if (step === 'awaiting_ton_sell_price') {
    const mmk = parseFloat(text);
    if (isNaN(mmk) || mmk <= 0) {
      bot.sendMessage(chatId, '❌ Invalid price. Enter a valid number:');
      return;
    }
    if (action === 'add') {
      db.prepare('INSERT INTO ton_prices (ton_amount, mmk_buy_price, mmk_sell_price) VALUES (?, ?, ?)').run(tempData.ton_amount, tempData.mmk_buy_price, mmk);
      bot.sendMessage(chatId, `✅ Added: ${tempData.ton_amount} TON\n🟢 Buy: ${tempData.mmk_buy_price} MMK\n🔴 Sell: ${mmk} MMK`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 TON Prices', callback_data: 'adm_ton_prices' }]] }
      });
    } else {
      db.prepare('UPDATE ton_prices SET ton_amount = ?, mmk_buy_price = ?, mmk_sell_price = ? WHERE id = ?').run(tempData.ton_amount, tempData.mmk_buy_price, mmk, tempData.id);
      bot.sendMessage(chatId, `✅ Updated: ${tempData.ton_amount} TON\n🟢 Buy: ${tempData.mmk_buy_price} MMK\n🔴 Sell: ${mmk} MMK`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 TON Prices', callback_data: 'adm_ton_prices' }]] }
      });
    }
    clearUserSession(telegramId);
  }
  // ---- TON Buy Price Edit Only ----
  else if (step === 'awaiting_ton_buy_price_edit') {
    const mmk = parseFloat(text);
    if (isNaN(mmk) || mmk <= 0) {
      bot.sendMessage(chatId, '❌ Invalid price. Enter a valid number:');
      return;
    }
    db.prepare('UPDATE ton_prices SET mmk_buy_price = ? WHERE id = ?').run(mmk, tempData.id);
    bot.sendMessage(chatId, `✅ Buy price updated: ${mmk} MMK`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 TON Prices', callback_data: 'adm_ton_prices' }]] }
    });
    clearUserSession(telegramId);
  }
  // ---- TON Sell Price Edit Only ----
  else if (step === 'awaiting_ton_sell_price_edit') {
    const mmk = parseFloat(text);
    if (isNaN(mmk) || mmk <= 0) {
      bot.sendMessage(chatId, '❌ Invalid price. Enter a valid number:');
      return;
    }
    db.prepare('UPDATE ton_prices SET mmk_sell_price = ? WHERE id = ?').run(mmk, tempData.id);
    bot.sendMessage(chatId, `✅ Sell price updated: ${mmk} MMK`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 TON Prices', callback_data: 'adm_ton_prices' }]] }
    });
    clearUserSession(telegramId);
  }

  // ---- USDT Price ----
  else if (step === 'awaiting_usdt_amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, '❌ Invalid amount. Enter a valid number:');
      return;
    }
    tempData.usdt_amount = amount;
    setUserSession(telegramId, 'admin_edit', 'awaiting_usdt_mmk', tempData);
    const currentMmk = tempData.current ? tempData.current.mmk_price : '';
    bot.sendMessage(chatId, `Enter MMK price${currentMmk ? ` (current: ${currentMmk})` : ''}:`);
  }
  else if (step === 'awaiting_usdt_mmk') {
    const mmk = parseFloat(text);
    if (isNaN(mmk) || mmk <= 0) {
      bot.sendMessage(chatId, '❌ Invalid price. Enter a valid number:');
      return;
    }
    if (action === 'add') {
      db.prepare('INSERT INTO usdt_prices (usdt_amount, mmk_price) VALUES (?, ?)').run(tempData.usdt_amount, mmk);
      bot.sendMessage(chatId, `✅ Added: ${tempData.usdt_amount} USDT = ${mmk} MMK`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 USDT Prices', callback_data: 'adm_usdt_prices' }]] }
      });
    } else {
      db.prepare('UPDATE usdt_prices SET usdt_amount = ?, mmk_price = ? WHERE id = ?').run(tempData.usdt_amount, mmk, tempData.id);
      bot.sendMessage(chatId, `✅ Updated: ${tempData.usdt_amount} USDT = ${mmk} MMK`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 USDT Prices', callback_data: 'adm_usdt_prices' }]] }
      });
    }
    clearUserSession(telegramId);
  }

  // ---- Star Price ----
  else if (step === 'awaiting_star_amount') {
    const amount = parseInt(text);
    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, '❌ Invalid amount. Enter a valid number:');
      return;
    }
    tempData.star_amount = amount;
    setUserSession(telegramId, 'admin_edit', 'awaiting_star_mmk', tempData);
    const currentMmk = tempData.current ? tempData.current.mmk_price : '';
    bot.sendMessage(chatId, `Enter MMK price${currentMmk ? ` (current: ${currentMmk})` : ''}:`);
  }
  else if (step === 'awaiting_star_mmk') {
    const mmk = parseFloat(text);
    if (isNaN(mmk) || mmk <= 0) {
      bot.sendMessage(chatId, '❌ Invalid price. Enter a valid number:');
      return;
    }
    if (action === 'add') {
      db.prepare('INSERT INTO star_prices (star_amount, mmk_price) VALUES (?, ?)').run(tempData.star_amount, mmk);
      bot.sendMessage(chatId, `✅ Added: ${tempData.star_amount} Stars = ${mmk} MMK`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Star Prices', callback_data: 'adm_star_prices' }]] }
      });
    } else {
      db.prepare('UPDATE star_prices SET star_amount = ?, mmk_price = ? WHERE id = ?').run(tempData.star_amount, mmk, tempData.id);
      bot.sendMessage(chatId, `✅ Updated: ${tempData.star_amount} Stars = ${mmk} MMK`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Star Prices', callback_data: 'adm_star_prices' }]] }
      });
    }
    clearUserSession(telegramId);
  }

  // ---- Premium Price ----
  else if (step === 'awaiting_prem_duration') {
    tempData.duration = text;
    setUserSession(telegramId, 'admin_edit', 'awaiting_prem_mmk', tempData);
    const currentMmk = tempData.current ? tempData.current.mmk_price : '';
    bot.sendMessage(chatId, `Enter MMK price${currentMmk ? ` (current: ${currentMmk})` : ''}:`);
  }
  else if (step === 'awaiting_prem_mmk') {
    const mmk = parseFloat(text);
    if (isNaN(mmk) || mmk <= 0) {
      bot.sendMessage(chatId, '❌ Invalid price. Enter a valid number:');
      return;
    }
    if (action === 'add') {
      db.prepare('INSERT INTO premium_prices (duration, mmk_price) VALUES (?, ?)').run(tempData.duration, mmk);
      bot.sendMessage(chatId, `✅ Added: ${tempData.duration} = ${mmk} MMK`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Premium Prices', callback_data: 'adm_premium_prices' }]] }
      });
    } else {
      db.prepare('UPDATE premium_prices SET duration = ?, mmk_price = ? WHERE id = ?').run(tempData.duration, mmk, tempData.id);
      bot.sendMessage(chatId, `✅ Updated: ${tempData.duration} = ${mmk} MMK`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Premium Prices', callback_data: 'adm_premium_prices' }]] }
      });
    }
    clearUserSession(telegramId);
  }

  // ---- Wallet Name ----
  else if (step === 'awaiting_wallet_name') {
    tempData.name = text;
    if (action === 'add') {
      setUserSession(telegramId, 'admin_edit', 'awaiting_wallet_uid', tempData);
      bot.sendMessage(chatId, 'Enter UID (or type "skip" to leave empty):');
    } else {
      db.prepare('UPDATE exchange_wallets SET name = ? WHERE id = ?').run(text, tempData.id);
      bot.sendMessage(chatId, `✅ Name updated: ${text}`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Wallets', callback_data: 'adm_wallets' }]] }
      });
      clearUserSession(telegramId);
    }
  }
  else if (step === 'awaiting_wallet_uid') {
    const uid = text === 'skip' ? null : text;
    if (action === 'add') {
      tempData.uid = uid;
      setUserSession(telegramId, 'admin_edit', 'awaiting_wallet_address', tempData);
      bot.sendMessage(chatId, 'Enter Address (or type "skip" to leave empty):');
    } else {
      db.prepare('UPDATE exchange_wallets SET uid = ? WHERE id = ?').run(uid, tempData.id);
      bot.sendMessage(chatId, `✅ UID updated`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Wallets', callback_data: 'adm_wallets' }]] }
      });
      clearUserSession(telegramId);
    }
  }
  else if (step === 'awaiting_wallet_address') {
    const address = text === 'skip' ? null : text;
    if (action === 'add') {
      db.prepare('INSERT INTO exchange_wallets (name, uid, address) VALUES (?, ?, ?)').run(tempData.name, tempData.uid, address);
      bot.sendMessage(chatId, `✅ Added wallet: ${tempData.name}`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Wallets', callback_data: 'adm_wallets' }]] }
      });
    } else {
      db.prepare('UPDATE exchange_wallets SET address = ? WHERE id = ?').run(address, tempData.id);
      bot.sendMessage(chatId, `✅ Address updated`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Wallets', callback_data: 'adm_wallets' }]] }
      });
    }
    clearUserSession(telegramId);
  }

  // ---- TON Address ----
  else if (step === 'awaiting_tonaddr_network') {
    tempData.network = text;
    if (action === 'add') {
      setUserSession(telegramId, 'admin_edit', 'awaiting_tonaddr_address', tempData);
      bot.sendMessage(chatId, 'Enter address:');
    } else {
      db.prepare('UPDATE ton_addresses SET network = ? WHERE id = ?').run(text, tempData.id);
      bot.sendMessage(chatId, `✅ Network updated: ${text}`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 TON Addresses', callback_data: 'adm_ton_addrs' }]] }
      });
      clearUserSession(telegramId);
    }
  }
  else if (step === 'awaiting_tonaddr_address') {
    if (action === 'add') {
      db.prepare('INSERT INTO ton_addresses (network, address) VALUES (?, ?)').run(tempData.network, text);
      bot.sendMessage(chatId, `✅ Added: ${tempData.network}`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 TON Addresses', callback_data: 'adm_ton_addrs' }]] }
      });
    } else {
      db.prepare('UPDATE ton_addresses SET address = ? WHERE id = ?').run(text, tempData.id);
      bot.sendMessage(chatId, `✅ Address updated`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 TON Addresses', callback_data: 'adm_ton_addrs' }]] }
      });
    }
    clearUserSession(telegramId);
  }

  // ---- Payment Info ----
  else if (step === 'awaiting_pay_name') {
    tempData.pay_name = text;
    if (action === 'add') {
      setUserSession(telegramId, 'admin_edit', 'awaiting_pay_phone', tempData);
      bot.sendMessage(chatId, 'Enter phone number:');
    } else {
      db.prepare('UPDATE payment_info SET name = ? WHERE id = ?').run(text, tempData.id);
      bot.sendMessage(chatId, `✅ Name updated: ${text}`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Payment Info', callback_data: 'adm_payment_info' }]] }
      });
      clearUserSession(telegramId);
    }
  }
  else if (step === 'awaiting_pay_phone') {
    if (action === 'add') {
      tempData.pay_phone = text;
      setUserSession(telegramId, 'admin_edit', 'awaiting_pay_method', tempData);
      bot.sendMessage(chatId, 'Enter payment method (e.g. KPAY, AYA PAY, WAVE PAY):');
    } else {
      db.prepare('UPDATE payment_info SET phone_number = ? WHERE id = ?').run(text, tempData.id);
      bot.sendMessage(chatId, `✅ Phone updated: ${text}`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Payment Info', callback_data: 'adm_payment_info' }]] }
      });
      clearUserSession(telegramId);
    }
  }
  else if (step === 'awaiting_pay_method') {
    if (action === 'add') {
      db.prepare('INSERT INTO payment_info (name, phone_number, payment_method) VALUES (?, ?, ?)').run(tempData.pay_name, tempData.pay_phone, text);
      bot.sendMessage(chatId, `✅ Added: ${tempData.pay_name} - ${tempData.pay_phone} [${text}]`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Payment Info', callback_data: 'adm_payment_info' }]] }
      });
    } else {
      db.prepare('UPDATE payment_info SET payment_method = ? WHERE id = ?').run(text, tempData.id);
      bot.sendMessage(chatId, `✅ Method updated: ${text}`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Payment Info', callback_data: 'adm_payment_info' }]] }
      });
    }
    clearUserSession(telegramId);
  }
}

// ============================================================
// USER MENU HANDLERS
// ============================================================

function handleTonMenu(chatId, telegramId) {
  const prices = db.prepare('SELECT * FROM ton_prices WHERE is_active = 1 ORDER BY ton_amount ASC').all();

  // Show Buy prices
  let buyText = '💎 TON TO DAY PRICES\n\n';
  buyText += '🟢 ဝယ်ဈေး (Buy Price)\n';
  buyText += '━━━━━━━━━━━━━━━━\n';
  for (const p of prices) {
    buyText += `${p.ton_amount}Ton - ${p.mmk_buy_price}MMK\n`;
  }

  // Show Sell prices
  buyText += '\n🔴 ရောင်းဈေး (Sell Price)\n';
  buyText += '━━━━━━━━━━━━━━━━\n';
  for (const p of prices) {
    buyText += `${p.ton_amount}Ton - ${p.mmk_sell_price}MMK\n`;
  }

  // Buttons - Buy and Sell for each price tier
  const buttons = [];
  for (const p of prices) {
    buttons.push([
      { text: `🟢 Buy ${p.ton_amount}Ton (${p.mmk_buy_price}MMK)`, callback_data: `ton_buy_${p.id}` },
      { text: `🔴 Sell ${p.ton_amount}Ton (${p.mmk_sell_price}MMK)`, callback_data: `ton_sell_${p.id}` }
    ]);
  }

  bot.sendMessage(chatId, buyText, { reply_markup: { inline_keyboard: buttons } });
}

function handleCryptoMenu(chatId, telegramId) {
  const prices = db.prepare('SELECT * FROM usdt_prices WHERE is_active = 1').all();
  let text = 'ရောင်းဈေး\n\n';
  const buttons = [];
  for (const p of prices) {
    text += `${p.usdt_amount}USDT-${p.mmk_price}MMK\n`;
    buttons.push([
      { text: `Buy ${p.usdt_amount}USDT`, callback_data: `usdt_buy_${p.id}` },
      { text: `Sell ${p.usdt_amount}USDT`, callback_data: `usdt_sell_${p.id}` }
    ]);
  }
  bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: buttons } });
}

function handleCryptoBuyExchange(chatId, telegramId, exchangeName) {
  const session = getUserSession(telegramId);
  const tempData = session?.temp_data || {};
  tempData.exchange_name = exchangeName;
  const wallet = db.prepare('SELECT * FROM exchange_wallets WHERE name = ? AND is_active = 1').get(exchangeName);

  if (wallet && wallet.address) {
    bot.sendMessage(chatId, `UID-${wallet.uid}\nAdresss- ${wallet.address}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Setup adress', callback_data: 'crypto_setup_address' }],
          [{ text: 'Main Menu', callback_data: 'main_menu' }],
          [{ text: 'Customer Support', callback_data: 'customer_support' }]
        ]
      }
    });
  } else {
    setUserSession(telegramId, 'crypto_buy', 'awaiting_wallet_address', tempData);
    bot.sendMessage(chatId, 'ကျေးဇူးပြု၍သင့်ရဲ့ယာယီWallet or Exchange Adressကိုပေးပို့ပါ');
  }
}

function handleCryptoSellExchange(chatId, telegramId, exchangeName) {
  const session = getUserSession(telegramId);
  const tempData = session?.temp_data || {};
  tempData.exchange_name = exchangeName;
  const wallet = db.prepare('SELECT * FROM exchange_wallets WHERE name = ? AND is_active = 1').get(exchangeName);

  if (wallet && wallet.address) {
    bot.sendMessage(chatId, `UID-${wallet.uid}\nAdresss- ${wallet.address}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Main Menu', callback_data: 'main_menu' }],
          [{ text: 'Complete ✅', callback_data: 'crypto_sell_complete' }]
        ]
      }
    });
  } else {
    setUserSession(telegramId, 'crypto_sell', 'awaiting_screenshot', tempData);
    bot.sendMessage(chatId, 'ကျေးဇူးပြု၍သင်လွှဲပြောင်းထားသော Screenshot ကိုပို့ပေးပါခင်ဗျာ', {
      reply_markup: { keyboard: [['Back Main Menu'], ['Customer Support']], resize_keyboard: true }
    });
  }
}

function handlePremiumStarMenu(chatId, telegramId) {
  bot.sendMessage(chatId, 'Telegram Premium (or) Telegram Starဝယ်ယူရန်', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Telegram Premium Buy', callback_data: 'premium_menu' }],
        [{ text: 'Telegram Star⭐ Buy', callback_data: 'star_menu' }]
      ]
    }
  });
}

function handleMonetizationMenu(chatId, telegramId) {
  bot.sendMessage(chatId, 'Telegram Monetization လျှောက်ရန်အတွက်Luxe Monetization Team ကိုဆက်သွယ်ပေးပါ', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Monetization Team', url: 'https://t.me/LuxeMonetization_Bot' }],
        [{ text: 'Main Menu', callback_data: 'main_menu' }]
      ]
    }
  });
}

async function handleAiChat(chatId, telegramId, msg) {
  setUserSession(telegramId, 'ai_chat', 'chatting', {});
  bot.sendMessage(chatId, '🤖 LUXE AI Assistant နှင့်စကားပြောနေပါသည်။ (Myanmar Language ဖြင့်သာဖြေဆိုပေးပါမည်)\n\nMain Menu သို့ပြန်သွားလိုပါက "Main Menu" ဟုရိုက်ပါ။', {
    reply_markup: { keyboard: [['Main Menu']], resize_keyboard: true }
  });
}

async function handleAiMessage(chatId, telegramId, text) {
  try {
    const ZAI = require('z-ai-web-dev-sdk').default;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are LUXE Exchange AI Assistant. You help users with crypto exchange questions, TON, USDT, Telegram Premium, Telegram Stars purchases. You only respond in Myanmar (Burmese) language. Be helpful and concise. You are part of LUXE Exchange Myanmar - a crypto exchange service. Payment methods include KPAY, AYA PAY, WAVE PAY.' },
        { role: 'user', content: text }
      ],
      temperature: 0.7,
      max_tokens: 500
    });
    const reply = completion.choices[0]?.message?.content || 'ဆောရီး၊ အခုအဖြေပေးနိုင်ရန် ခက်ခဲနေပါသည်။';
    bot.sendMessage(chatId, reply);
  } catch (err) {
    console.error('AI Error:', err);
    bot.sendMessage(chatId, 'AI စနစ်တွင်အခက်အခဲရှိနေပါသည်။ ခဏနေ၍ထပ်စမ်းကြည့်ပါ။');
  }
}

function handleOtherMenu(chatId, telegramId) {
  bot.sendMessage(chatId, 'အခြားဝန်ဆောင်မှုများ', {
    reply_markup: { keyboard: [['Customer Support'], ['Main Menu']], resize_keyboard: true }
  });
}

function handleSessionMessage(chatId, telegramId, text, msg) {
  const session = getUserSession(telegramId);
  if (!session) return;

  // AI Chat flow
  if (session.current_flow === 'ai_chat') {
    handleAiMessage(chatId, telegramId, text);
    return;
  }

  // ==== TON Buy V2 - awaiting wallet address input ====
  if (session.current_flow === 'ton_buy' && session.step === 'awaiting_ton_wallet') {
    const tempData = session.temp_data || {};
    tempData.ton_wallet_address = text;
    setUserSession(telegramId, 'ton_buy', 'wallet_set', tempData);
    bot.sendMessage(chatId, 'ယာယီTon Wallet Addressအားသတ်မှတ်ပြီးပါပြီ', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Complete', callback_data: 'ton_buy_complete' }],
          [{ text: 'Main Menu', callback_data: 'main_menu' }]
        ]
      }
    });
    return;
  }

  // ==== TON Sell V2 - awaiting MMK pay info ====
  if (session.current_flow === 'ton_sell' && session.step === 'awaiting_mmk_pay') {
    const tempData = session.temp_data || {};
    const lines = text.trim().split('\n');
    const nameLine = lines[0] || '';
    tempData.payment_name = nameLine;
    tempData.payment_raw = text;

    // Try to extract phone and method from all lines
    for (const line of lines) {
      const match = line.match(/(\d+)\s*\(([^)]+)\)/);
      if (match) {
        tempData.payment_phone = match[1];
        tempData.payment_method = match[2];
      }
    }

    setUserSession(telegramId, 'ton_sell', 'mmk_pay_set', tempData);
    bot.sendMessage(chatId, 'MMK Pay အားသတ်မှတ်ပြီးပါပြီ', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Complete', callback_data: 'ton_sell_complete' }],
          [{ text: 'Main Menu', callback_data: 'main_menu' }]
        ]
      }
    });
    return;
  }

  // Crypto Buy - awaiting wallet address
  if (session.current_flow === 'crypto_buy' && session.step === 'awaiting_wallet_address') {
    const tempData = session.temp_data || {};
    tempData.wallet_address = text;
    setUserSession(telegramId, 'crypto_buy', 'wallet_set', tempData);
    bot.sendMessage(chatId, 'ယာယီwallet adressအားသတ်မှတ်ပြီးပါပြီ', {
      reply_markup: { keyboard: [['Back Main Menu'], ['Complete Payment']], resize_keyboard: true }
    });
    setTimeout(() => { bot.sendMessage(chatId, getPaymentInfoText()); }, 500);
    return;
  }

  // Crypto Sell - awaiting USDT amount
  if (session.current_flow === 'crypto_sell' && session.step === 'awaiting_usdt_amount') {
    const tempData = session.temp_data || {};
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, 'ကျေးဇူးပြု၍ မှန်ကန်သော USDT ပမာဏကိုရိုက်ထည့်ပါ');
      return;
    }
    tempData.custom_usdt_amount = amount;
    setUserSession(telegramId, 'crypto_sell', 'setup_mmk_pay', tempData);
    bot.sendMessage(chatId, 'သင်ရောင်းလိုသောUsdtပမာဏကိုသတ်မှတ်ပြီးပါပြီ', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Setup MMK PAY', callback_data: 'crypto_sell_setup_mmk' }],
          [{ text: 'Back Main Menu', callback_data: 'main_menu' }]
        ]
      }
    });
    return;
  }

  // Crypto Sell - awaiting MMK pay info
  if (session.current_flow === 'crypto_sell' && session.step === 'awaiting_mmk_pay') {
    const tempData = session.temp_data || {};
    const lines = text.trim().split('\n');
    const nameLine = lines[0] || '';
    tempData.payment_name = nameLine;
    tempData.payment_raw = text;
    for (const line of lines.slice(1)) {
      const match = line.match(/(\d+)\s*\(([^)]+)\)/);
      if (match) {
        tempData.payment_phone = match[1];
        tempData.payment_method = match[2];
        break;
      }
    }
    setUserSession(telegramId, 'crypto_sell', 'select_exchange', tempData);
    bot.sendMessage(chatId, 'သင်USDTလွှဲလိုသောExchange or Walletကိုရွေးရှယ်ပေးပါ', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Binance Exchange', callback_data: 'crypto_sell_exchange_Binance_Exchange' }],
          [{ text: 'Bitget Exchange', callback_data: 'crypto_sell_exchange_Bitget_Exchange' }],
          [{ text: 'OKX Exchange', callback_data: 'crypto_sell_exchange_OKX_Exchange' }],
          [{ text: 'Other Third Party Wallets', callback_data: 'crypto_sell_exchange_Other_Third_Party_Wallets' }],
          [{ text: 'Main Menu', callback_data: 'main_menu' }],
          [{ text: 'Customer Support', callback_data: 'customer_support' }]
        ]
      }
    });
    return;
  }
}

// ============================================================
// SCREENSHOT HANDLER
// ============================================================

async function handleScreenshot(msg) {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from.id);
  const session = getUserSession(telegramId);
  if (!session) return;

  const photo = msg.photo[msg.photo.length - 1];
  const fileId = photo.file_id;
  let orderId;
  const tempData = session.temp_data || {};

  let extraInfo = {};

  if (session.current_flow === 'ton_buy') {
    // V2: Include user's TON wallet address in order
    orderId = createOrder(telegramId, 'Buy', 'TON', tempData.ton_amount, tempData.mmk_price, {
      wallet_address: tempData.ton_wallet_address || ''
    });
    setUserSession(telegramId, 'ton_buy', 'screenshot_sent', { ...tempData, order_id: orderId });
  } else if (session.current_flow === 'ton_sell') {
    // V2: Include user's MMK pay info in order
    orderId = createOrder(telegramId, 'Sell', 'TON', tempData.ton_amount, tempData.mmk_price, {
      payment_name: tempData.payment_name || '',
      payment_phone: tempData.payment_phone || '',
      payment_method: tempData.payment_method || ''
    });
    extraInfo.payment_raw = tempData.payment_raw || '';
    setUserSession(telegramId, 'ton_sell', 'screenshot_sent', { ...tempData, order_id: orderId });
  } else if (session.current_flow === 'crypto_buy') {
    orderId = createOrder(telegramId, 'Buy', 'USDT', tempData.usdt_amount, tempData.mmk_price, {
      wallet_address: tempData.wallet_address, exchange_name: tempData.exchange_name
    });
    setUserSession(telegramId, 'crypto_buy', 'screenshot_sent', { ...tempData, order_id: orderId });
  } else if (session.current_flow === 'crypto_sell') {
    orderId = createOrder(telegramId, 'Sell', 'USDT', tempData.usdt_amount, tempData.mmk_price, {
      exchange_name: tempData.exchange_name, payment_name: tempData.payment_name,
      payment_phone: tempData.payment_phone, payment_method: tempData.payment_method
    });
    extraInfo.payment_raw = tempData.payment_raw || '';
    setUserSession(telegramId, 'crypto_sell', 'screenshot_sent', { ...tempData, order_id: orderId });
  } else if (session.current_flow === 'star_buy') {
    orderId = createOrder(telegramId, 'Buy', 'Telegram Stars', tempData.star_amount, tempData.mmk_price, {});
    setUserSession(telegramId, 'star_buy', 'screenshot_sent', { ...tempData, order_id: orderId });
  } else if (session.current_flow === 'premium_buy') {
    orderId = createOrder(telegramId, 'Buy', 'Telegram Premium', null, tempData.mmk_price, {});
    setUserSession(telegramId, 'premium_buy', 'screenshot_sent', { ...tempData, order_id: orderId });
  } else {
    return;
  }

  db.prepare('UPDATE orders SET screenshot_file_id = ? WHERE order_id = ?').run(fileId, orderId);
  await sendOrderToAdmin(orderId, telegramId, fileId, extraInfo);
  bot.sendMessage(chatId, '✅ သင်၏ငွေချေမှု Slip ရရှိပါပြီ။ Admin စစ်ဆေးပြီးကြောင်းအကြောင်းကြားပေးပါမည်။', {
    reply_markup: { keyboard: [['Back Main Menu'], ['Customer Support']], resize_keyboard: true }
  });
}

// ============================================================
// CONFIRM / REJECT ORDER
// ============================================================

function confirmOrder(orderId, adminChatId) {
  console.log(`[ADMIN] Confirming order: ${orderId}`);
  const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
  if (!order) {
    console.error(`[ADMIN] Order not found: ${orderId}`);
    bot.sendMessage(adminChatId, `❌ Order ${orderId} not found in database.`);
    return;
  }
  db.prepare("UPDATE orders SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE order_id = ?").run(orderId);

  // Build detailed order notification for user
  let userMsg = `✅ *လုပ်ဆောင်မှုအောင်မြင်ပါသည်*\n\n`;
  userMsg += `Order ID: ${orderId}\n`;
  userMsg += `Type: ${order.order_type}\n`;
  userMsg += `Category: ${order.category}\n`;
  if (order.amount) userMsg += `Amount: ${order.amount}\n`;
  if (order.mmk_amount) userMsg += `MMK: ${Number(order.mmk_amount).toLocaleString()}\n`;
  if (order.wallet_address) userMsg += `Wallet: ${order.wallet_address}\n`;
  if (order.exchange_name) userMsg += `Exchange: ${order.exchange_name}\n`;
  if (order.payment_name) userMsg += `Payment Name: ${order.payment_name}\n`;
  if (order.payment_phone) userMsg += `Payment Phone: ${order.payment_phone}\n`;
  if (order.payment_method) userMsg += `Payment Method: ${order.payment_method}\n`;
  userMsg += `Status: ✅ Successful (လုပ်ဆောင်မှုအောင်မြင်ပါသည်)`;

  try {
    bot.sendMessage(order.telegram_id, userMsg, {
      parse_mode: 'Markdown',
      reply_markup: { keyboard: [['Main Menu'], ['Customer Support']], resize_keyboard: true }
    });
  } catch (e) {
    console.error('[ADMIN] Error notifying user:', e.message);
  }
  clearUserSession(order.telegram_id);
  bot.sendMessage(adminChatId, `✅ Order ${orderId} confirmed.`);
}

function rejectOrder(orderId, adminChatId) {
  console.log(`[ADMIN] Rejecting order: ${orderId}`);
  const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
  if (!order) {
    console.error(`[ADMIN] Order not found: ${orderId}`);
    bot.sendMessage(adminChatId, `❌ Order ${orderId} not found in database.`);
    return;
  }
  db.prepare("UPDATE orders SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE order_id = ?").run(orderId);

  // Build detailed order notification for user
  let userMsg = `❌ *လုပ်ဆောင်မှုမအောင်မြင်ပါ*\n\n`;
  userMsg += `Order ID: ${orderId}\n`;
  userMsg += `Type: ${order.order_type}\n`;
  userMsg += `Category: ${order.category}\n`;
  if (order.amount) userMsg += `Amount: ${order.amount}\n`;
  if (order.mmk_amount) userMsg += `MMK: ${Number(order.mmk_amount).toLocaleString()}\n`;
  userMsg += `Status: ❌ Rejected (လုပ်ဆောင်မှုမအောင်မြင်ပါ)\n\n`;
  userMsg += `ကျေးဇူးပြု၍ Customer Support ကိုဆက်သွယ်ပါ။`;

  try {
    bot.sendMessage(order.telegram_id, userMsg, {
      parse_mode: 'Markdown',
      reply_markup: { keyboard: [['Main Menu'], ['Customer Support']], resize_keyboard: true }
    });
  } catch (e) {
    console.error('[ADMIN] Error notifying user:', e.message);
  }
  clearUserSession(order.telegram_id);
  bot.sendMessage(adminChatId, `❌ Order ${orderId} rejected.`);
}

// ============================================================
// ERROR HANDLING
// ============================================================

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

console.log('🤖 LUXE Exchange Bot is running... (Admin via Telegram)');
