const rateLimit = require('express-rate-limit');

// Untuk endpoint publik yang membuat data (kirim laporan): longgar tapi tetap dibatasi
const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 20, // maksimal 20 laporan per IP per 15 menit
  message: { message: 'Terlalu banyak laporan dikirim, coba lagi beberapa menit lagi.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Untuk login: ketat, karena ini target utama brute-force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // maksimal 5 percobaan login per IP per 15 menit
  message: { message: 'Terlalu banyak percobaan login, coba lagi beberapa menit lagi.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Untuk endpoint baca data (GET): lebih longgar lagi, karena peta yang digeser-geser wajar memanggil banyak kali
const readLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 menit
  max: 120,
  message: { message: 'Terlalu banyak permintaan, coba lagi sebentar lagi.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { createLimiter, loginLimiter, readLimiter };