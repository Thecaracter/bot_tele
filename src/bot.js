const TelegramBot = require('node-telegram-bot-api');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');

// Inisialisasi variabel environment
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://bot-tele-ten-dun.vercel.app/api/webhook';
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);

// Konfigurasi Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Inisialisasi bot
const bot = new TelegramBot(TOKEN);
bot.setWebHook(WEBHOOK_URL);

// State dan data pengguna
const userStates = {};
const userData = {};

// Fungsi-fungsi utilitas
function getUserName(msg) {
  return msg.from.username || 'Username tidak tersedia';
}

function generateOrderId() {
  return 'ORDER' + Date.now().toString().slice(-6);
}

async function getSheet() {
  const client = new JWT({
    email: CREDENTIALS.client_email,
    key: CREDENTIALS.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const doc = new GoogleSpreadsheet(SHEET_ID, client);
  await doc.loadInfo();
  return doc.sheetsByIndex[0];
}

async function updateSheet(orderId, updateValues) {
  const sheet = await getSheet();
  const rows = await sheet.getRows();
  let rowToUpdate = rows.find(row => row.OrderId?.trim() === orderId?.trim());
  if (rowToUpdate) {
    Object.keys(updateValues).forEach(key => {
      if (updateValues[key] !== undefined) {
        rowToUpdate[key] = updateValues[key];
      }
    });
    await rowToUpdate.save();
  } else {
    await sheet.addRow(updateValues);
  }
}

async function uploadToCloudinary(fileBuffer, fileName) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { resource_type: "auto", public_id: fileName, folder: "bukti_pembayaran" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    ).end(fileBuffer);
  });
}

// Fungsi-fungsi bot
function sendMainMenu(chatId) {
  const options = {
    reply_markup: {
      keyboard: [
        ['Pesan Joki'],
        ['Info Layanan'],
        ['Hubungi Admin']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
  return bot.sendMessage(chatId, 'Selamat datang di Joki Bot! Silakan pilih menu:', options);
}

function sendKeyboardWithMainMenu(chatId, message, options = []) {
  const keyboard = [
    ...options.map(option => [option]),
    ['Kembali ke Menu Utama']
  ];
  const replyMarkup = {
    keyboard: keyboard,
    resize_keyboard: true,
    one_time_keyboard: false
  };
  return bot.sendMessage(chatId, message, { reply_markup: replyMarkup });
}

async function sendInvoice(chatId, isDP = true) {
  const data = userData[chatId];
  let invoiceText = `Invoice Pemesanan\nID Pesanan: ${data.OrderId}\n\n`;
  invoiceText += `Nama: ${data.Nama}\n`;
  invoiceText += `Username: ${data.Username}\n`;
  invoiceText += `Pembuatan: ${data.Pembuatan}\n`;
  invoiceText += `Keperluan: ${data.Keperluan}\n`;
  invoiceText += `Teknologi: ${data.Teknologi}\n`;
  invoiceText += `Fitur: ${data.Fitur}\n`;
  invoiceText += `Mockup: ${data.Mockup}\n`;
  invoiceText += `Deadline: ${data.Deadline}\n`;
  invoiceText += `Akun TikTok: ${data.AkunTiktok}\n\n`;
  invoiceText += isDP
    ? "Silakan lakukan pembayaran DP 30% untuk memulai proyek.\nKirimkan bukti pembayaran DP dalam bentuk foto."
    : "Silakan lakukan pelunasan pembayaran untuk menyelesaikan proyek.\nKirimkan bukti pelunasan dalam bentuk foto.";
  return bot.sendMessage(chatId, invoiceText);
}

async function handlePaymentProof(msg, isDP = true) {
  const chatId = msg.chat.id;
  const photo = msg.photo[msg.photo.length - 1];
  const fileId = photo.file_id;
  const telegramId = msg.from.id;

  try {
    const fileUrl = await bot.getFileLink(fileId);
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const fileBuffer = Buffer.from(response.data, 'binary');

    let orderId = userData[chatId]?.OrderId;
    if (!orderId) {
      throw new Error('OrderId tidak ditemukan');
    }

    const fileName = `${orderId}_${isDP ? 'DP' : 'Pelunasan'}`;
    const cloudinaryResult = await uploadToCloudinary(fileBuffer, fileName);

    let updateData = {
      ...userData[chatId],
      TelegramID: telegramId,
      Status: isDP ? 'DP Dibayar' : 'Lunas',
      [isDP ? 'BuktiDP' : 'BuktiPelunasan']: cloudinaryResult.secure_url
    };

    await updateSheet(orderId, updateData);
    await bot.sendMessage(chatId, `Bukti pembayaran berhasil diunggah dan status pesanan telah diperbarui.`);
    await bot.sendMessage(chatId, isDP
      ? "Terima kasih atas pembayaran DP. Tim kami akan segera memproses pesanan Anda."
      : "Terima kasih atas pelunasan. Pesanan Anda akan segera diselesaikan."
    );

    delete userStates[chatId];
    delete userData[chatId];
    return sendMainMenu(chatId);
  } catch (error) {
    console.error('Error saat memproses bukti pembayaran:', error);
    return bot.sendMessage(chatId, 'Terjadi kesalahan saat mengunggah bukti pembayaran. Silakan coba lagi nanti.');
  }
}

// Handler pesan utama
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const messageText = msg.text;
  const currentState = userStates[chatId] || 'main_menu';

  console.log(`Processing message for chatId: ${chatId}, currentState: ${currentState}, message: ${messageText}`);

  if (messageText === 'Kembali ke Menu Utama') {
    delete userStates[chatId];
    delete userData[chatId];
    return sendMainMenu(chatId);
  }

  if (!userData[chatId]) {
    userData[chatId] = { Username: getUserName(msg) };
  }

  if (msg.photo && (currentState === 'waiting_dp' || currentState === 'pelunasan')) {
    return handlePaymentProof(msg, currentState === 'waiting_dp');
  }

  switch (currentState) {
    case 'main_menu':
      switch (messageText) {
        case 'Pesan Joki':
          userStates[chatId] = 'ask_joki';
          return sendKeyboardWithMainMenu(chatId, 'Apakah Anda belum joki atau sudah joki?', ['Belum Joki', 'Sudah Joki']);
        case 'Info Layanan':
          await bot.sendMessage(chatId, 'Kami menyediakan layanan joki untuk berbagai kebutuhan. Silakan hubungi admin untuk informasi lebih lanjut.');
          return sendMainMenu(chatId);
        case 'Hubungi Admin':
          await bot.sendMessage(chatId, 'Silakan hubungi admin kami di @namaadmin');
          return sendMainMenu(chatId);
        default:
          return sendMainMenu(chatId);
      }
    case 'ask_joki':
      if (messageText === 'Belum Joki') {
        userStates[chatId] = 'nama';
        userData[chatId] = { ...userData[chatId], OrderId: generateOrderId() };
        return sendKeyboardWithMainMenu(chatId, 'Silakan isi form berikut:\n1. Nama');
      } else if (messageText === 'Sudah Joki') {
        userStates[chatId] = 'check_order_id';
        return sendKeyboardWithMainMenu(chatId, 'Silakan masukkan ID Pemesanan Anda:');
      }
      break;
    case 'check_order_id':
      userData[chatId] = { ...userData[chatId], OrderId: messageText };
      userStates[chatId] = 'pelunasan';
      return sendKeyboardWithMainMenu(chatId, 'Silakan kirimkan bukti pembayaran pelunasan dalam bentuk foto.');
    case 'nama':
      userData[chatId].Nama = messageText;
      userStates[chatId] = 'pembuatan';
      return sendKeyboardWithMainMenu(chatId, '2. Pembuatan (contoh: website/android/mobile/desktop)/bahasa pemrograman');
    case 'pembuatan':
      userData[chatId].Pembuatan = messageText;
      userStates[chatId] = 'keperluan';
      return sendKeyboardWithMainMenu(chatId, '3. Keperluan (contoh: tugas kuliah/ skripsi/ UMKM)');
    case 'keperluan':
      userData[chatId].Keperluan = messageText;
      userStates[chatId] = 'teknologi';
      return sendKeyboardWithMainMenu(chatId, '4. Teknologi/ Bahasa Pemrograman (isi bebas jika tidak ada bahasa yang diperlukan)');
    case 'teknologi':
      userData[chatId].Teknologi = messageText;
      userStates[chatId] = 'fitur';
      return sendKeyboardWithMainMenu(chatId, '5. Fitur');
    case 'fitur':
      userData[chatId].Fitur = messageText;
      userStates[chatId] = 'mockup';
      return sendKeyboardWithMainMenu(chatId, '6. Ada mock up/ prototype?', ['Ya', 'Tidak']);
    case 'mockup':
      userData[chatId].Mockup = messageText;
      userStates[chatId] = 'deadline';
      return sendKeyboardWithMainMenu(chatId, '7. Deadline (format: dd/mm/yyyy)');
    case 'deadline':
      userData[chatId].Deadline = messageText;
      userStates[chatId] = 'tiktok';
      return sendKeyboardWithMainMenu(chatId, '8. Akun TikTok (jika chat di TikTok)');
    case 'tiktok':
      userData[chatId].AkunTiktok = messageText;
      userData[chatId].Status = 'Menunggu DP';
      userData[chatId].TelegramID = msg.from.id;
      await updateSheet(userData[chatId].OrderId, userData[chatId]);
      await sendInvoice(chatId, true);
      userStates[chatId] = 'waiting_dp';
      return sendKeyboardWithMainMenu(chatId, 'Pesanan Anda telah dicatat. Silakan lakukan pembayaran DP.');
    default:
      return sendKeyboardWithMainMenu(chatId, 'Maaf, saya tidak mengerti. Silakan gunakan menu yang tersedia.');
  }
}

// Webhook handler
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      const update = req.body;
      console.log('Received update:', JSON.stringify(update));
      if (update.message) {
        await handleMessage(update.message);
      }
      res.status(200).send('OK');
    } else {
      res.status(200).send('Webhook is active');
    }
  } catch (error) {
    console.error('Error in webhook handler:', error);
    res.status(500).send('Internal Server Error');
  }
};

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});