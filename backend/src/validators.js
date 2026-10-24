const CATEGORIES = ['jalan', 'penerangan', 'kebersihan', 'drainase', 'lainnya'];
const STATUSES = ['pending', 'diproses', 'selesai'];

function isValidLat(lat) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function isValidLng(lng) {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

function isValidCategory(category) {
  return CATEGORIES.includes(category);
}

function isValidStatus(status) {
  return STATUSES.includes(status);
}

module.exports = { CATEGORIES, STATUSES, isValidLat, isValidLng, isValidCategory, isValidStatus };