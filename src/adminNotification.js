const TelegramBot = require('node-telegram-bot-api');

// Pastikan untuk menggunakan token yang sama dengan bot utama 
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN);

const ADMIN_CHAT_IDS = [1331471353, 1653826853];

async function sendAdminNotification(message) {
    for (const chatId of ADMIN_CHAT_IDS) {
        try {
            // Mengirim pesan langsung ke setiap admin menggunakan chat ID
            await bot.sendMessage(chatId, message);
            console.log(`Notifikasi berhasil dikirim ke admin (Chat ID: ${chatId})`);
        } catch (error) {
            console.error(`Gagal mengirim notifikasi ke admin (Chat ID: ${chatId}):`, error);
        }
    }
}

module.exports = { sendAdminNotification };