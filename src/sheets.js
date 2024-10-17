const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CREDENTIALS = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);

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

async function appendToSheet(values) {
  const sheet = await getSheet();
  await sheet.addRow(values);
}

async function updateSheet(orderId, updateValues) {
  const sheet = await getSheet();
  const rows = await sheet.getRows();
  const rowToUpdate = rows.find(row => row.orderId === orderId);
  if (rowToUpdate) {
    Object.keys(updateValues).forEach(key => {
      rowToUpdate[key] = updateValues[key];
    });
    await rowToUpdate.save();
  }
}

module.exports = { appendToSheet, updateSheet };