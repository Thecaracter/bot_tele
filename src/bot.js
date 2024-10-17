require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { sendAdminNotification } = require('./adminNotification');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CREDENTIALS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'credentials.json')));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const userStates = {};
const userData = {};

function getUserName(msg) {
  return msg.from.username || 'Username tidak tersedia';
}

async function uploadToCloudinary(fileBuffer, fileName) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        resource_type: "auto",
        public_id: fileName,
        folder: "bukti_pembayaran"
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    ).end(fileBuffer);
  });
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

async function ensureHeaderExists(sheet) {
  try {
    await sheet.loadHeaderRow();
  } catch (error) {
    if (error.message.includes('No values in the header row')) {
      const headers = ['Nama', 'Username', 'Pembuatan', 'Keperluan', 'Teknologi', 'Fitur', 'Mockup', 'Deadline', 'AkunTiktok', 'OrderId', 'Status', 'BuktiDP', 'BuktiPelunasan', 'TelegramID'];
      await sheet.setHeaderRow(headers);
    } else {
      throw error;
    }
  }
}

async function updateSheet(orderId, updateValues) {
  const sheet = await getSheet();
  await ensureHeaderExists(sheet);
  const rows = await sheet.getRows();

  console.log(`Mencari baris dengan OrderId: ${orderId}`);

  let rowToUpdate = rows.find(row => row.OrderId?.trim() === orderId?.trim());

  if (rowToUpdate) {
    console.log(`Baris ditemukan untuk OrderId: ${orderId}, memperbarui nilai...`);
    Object.keys(updateValues).forEach(key => {
      if (updateValues[key] !== undefined) {
        console.log(`Memperbarui ${key}: ${rowToUpdate[key]} -> ${updateValues[key]}`);
        rowToUpdate[key] = updateValues[key];
      }
    });
    try {
      await rowToUpdate.save();
      console.log(`Baris berhasil diperbarui untuk OrderId: ${orderId}`);
    } catch (error) {
      console.error(`Gagal menyimpan pembaruan untuk OrderId: ${orderId}`, error);
      throw error;
    }
  } else {
    console.log(`Tidak ada baris yang ditemukan untuk OrderId: ${orderId}, menambahkan baris baru...`);
    try {
      await sheet.addRow(updateValues);
      console.log(`Baris baru berhasil ditambahkan untuk OrderId: ${orderId}`);
    } catch (error) {
      console.error(`Gagal menambahkan baris baru untuk OrderId: ${orderId}`, error);
      throw error;
    }
  }

  // Kirim notifikasi ke admin
  const newOrderMessage = `Pesanan baru atau diperbarui:\nOrder ID: ${orderId}\nNama: ${updateValues.Nama}\nUsername: ${updateValues.Username},\nStatus: ${updateValues.Status}`;
  await sendAdminNotification(newOrderMessage);
}

function generateOrderId() {
  return 'ORDER' + Date.now().toString().slice(-6);
}

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
  bot.sendMessage(chatId, 'Selamat datang di Joki Bot! Silakan pilih menu:', options);
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
  bot.sendMessage(chatId, message, { reply_markup: replyMarkup });
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

  if (isDP) {
    invoiceText += "Silakan lakukan pembayaran DP 30% untuk memulai proyek.\n";
    invoiceText += "Kirimkan bukti pembayaran DP dalam bentuk foto.";
  } else {
    invoiceText += "Silakan lakukan pelunasan pembayaran untuk menyelesaikan proyek.\n";
    invoiceText += "Kirimkan bukti pelunasan dalam bentuk foto.";
  }

  await bot.sendMessage(chatId, invoiceText);
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
    console.log(`Bukti pembayaran berhasil diunggah untuk OrderId: ${orderId}`);

    await bot.sendMessage(chatId, `Bukti pembayaran berhasil diunggah dan status pesanan telah diperbarui.`);

    if (isDP) {
      await bot.sendMessage(chatId, "Terima kasih atas pembayaran DP. Tim kami akan segera memproses pesanan Anda.");
    } else {
      await bot.sendMessage(chatId, "Terima kasih atas pelunasan. Pesanan Anda akan segera diselesaikan.");
    }

    // Reset state setelah proses selesai
    delete userStates[chatId];
    delete userData[chatId];
    sendMainMenu(chatId);

  } catch (error) {
    console.error('Error saat memproses bukti pembayaran:', error);
    await bot.sendMessage(chatId, 'Terjadi kesalahan saat mengunggah bukti pembayaran. Silakan coba lagi nanti.');
  }
}

function resetUserState(chatId) {
  delete userStates[chatId];
  delete userData[chatId];
  sendMainMenu(chatId);
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  resetUserState(chatId);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;
  const currentState = userStates[chatId] || 'main_menu';

  if (messageText === 'Kembali ke Menu Utama') {
    resetUserState(chatId);
    return;
  }

  if (!userData[chatId]) {
    userData[chatId] = { Username: getUserName(msg) };
  }

  if (msg.photo && (currentState === 'waiting_dp' || currentState === 'pelunasan')) {
    await handlePaymentProof(msg, currentState === 'waiting_dp');
    return;
  }

  switch (currentState) {
    case 'main_menu':
      switch (messageText) {
        case 'Pesan Joki':
          sendKeyboardWithMainMenu(chatId, 'Apakah Anda belum joki atau sudah joki?', ['Belum Joki', 'Sudah Joki']);
          userStates[chatId] = 'ask_joki';
          break;
        case 'Info Layanan':
          await bot.sendMessage(chatId, 'Kami menyediakan layanan joki untuk berbagai kebutuhan. Silakan hubungi admin untuk informasi lebih lanjut.');
          sendMainMenu(chatId);
          break;
        case 'Hubungi Admin':
          await bot.sendMessage(chatId, 'Silakan hubungi admin kami di @namaadmin');
          sendMainMenu(chatId);
          break;
        default:
          sendMainMenu(chatId);
          break;
      }
      break;
    case 'ask_joki':
      if (messageText === 'Belum Joki') {
        userStates[chatId] = 'nama';
        userData[chatId] = {
          ...userData[chatId],
          OrderId: generateOrderId()
        };
        sendKeyboardWithMainMenu(chatId, 'Silakan isi form berikut:\n1. Nama');
      } else if (messageText === 'Sudah Joki') {
        userStates[chatId] = 'check_order_id';
        sendKeyboardWithMainMenu(chatId, 'Silakan masukkan ID Pemesanan Anda:');
      }
      break;
    case 'check_order_id':
      userData[chatId] = {
        ...userData[chatId],
        OrderId: messageText
      };
      sendKeyboardWithMainMenu(chatId, 'Silakan kirimkan bukti pembayaran pelunasan dalam bentuk foto.');
      userStates[chatId] = 'pelunasan';
      break;
    case 'nama':
      userData[chatId].Nama = messageText;
      sendKeyboardWithMainMenu(chatId, '2. Pembuatan (contoh: website/android/mobile/desktop)/bahasa pemrograman');
      userStates[chatId] = 'pembuatan';
      break;
    case 'pembuatan':
      userData[chatId].Pembuatan = messageText;
      sendKeyboardWithMainMenu(chatId, '3. Keperluan (contoh: tugas kuliah/ skripsi/ UMKM)');
      userStates[chatId] = 'keperluan';
      break;
    case 'keperluan':
      userData[chatId].Keperluan = messageText;
      sendKeyboardWithMainMenu(chatId, '4. Teknologi/ Bahasa Pemrograman (isi bebas jika tidak ada bahasa yang diperlukan)');
      userStates[chatId] = 'teknologi';
      break;
    case 'teknologi':
      userData[chatId].Teknologi = messageText;
      sendKeyboardWithMainMenu(chatId, '5. Fitur');
      userStates[chatId] = 'fitur';
      break;
    case 'fitur':
      userData[chatId].Fitur = messageText;
      sendKeyboardWithMainMenu(chatId, '6. Ada mock up/ prototype?', ['Ya', 'Tidak']);
      userStates[chatId] = 'mockup';
      break;
    case 'mockup':
      userData[chatId].Mockup = messageText;
      sendKeyboardWithMainMenu(chatId, '7. Deadline (format: dd/mm/yyyy)');
      userStates[chatId] = 'deadline';
      break;
    case 'deadline':
      userData[chatId].Deadline = messageText;
      sendKeyboardWithMainMenu(chatId, '8. Akun TikTok (jika chat di TikTok)');
      userStates[chatId] = 'tiktok';
      break;
    case 'tiktok':
      userData[chatId].AkunTiktok = messageText;
      userData[chatId].Status = 'Menunggu DP';
      userData[chatId].TelegramID = msg.from.id;
      await updateSheet(userData[chatId].OrderId, userData[chatId]);
      await sendInvoice(chatId, true);
      userStates[chatId] = 'waiting_dp';
      sendKeyboardWithMainMenu(chatId, 'Pesanan Anda telah dicatat. Silakan lakukan pembayaran DP.');
      break;
    default:
      sendKeyboardWithMainMenu(chatId, 'Maaf, saya tidak mengerti. Silakan gunakan menu yang tersedia.');
      break;
  }
});

console.log('Bot sedang berjalan...');