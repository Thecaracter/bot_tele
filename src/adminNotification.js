const TelegramBot = require('node-telegram-bot-api');

// Pastikan untuk menggunakan token yang sama dengan bot utama
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN);

const ADMIN_CHAT_ID = 1331471353;

async function sendAdminNotification(message) {
    try {
        // Mengirim pesan langsung ke admin menggunakan chat ID
        await bot.sendMessage(ADMIN_CHAT_ID, message);
        console.log(`Notifikasi berhasil dikirim ke admin (Chat ID: ${ADMIN_CHAT_ID})`);
    } catch (error) {
        console.error('Gagal mengirim notifikasi ke admin:', error);
    }
}

module.exports = { sendAdminNotification };