const { createLimiter, readLimiter } = require('../middleware/rateLimiters');
const express = require('express');
const pool = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const router = express.Router();

const { CATEGORIES, STATUSES, isValidLat, isValidLng, isValidCategory, isValidStatus } = require('../validators');

// Kolom yang dipakai berulang di setiap query SELECT
const SELECT_COLUMNS =
  'r.id, r.title, r.description, r.category, r.status, r.photo_url, r.created_at, ' +
  'zr.name AS zone_name, ST_AsGeoJSON(r.geom) AS geometry';

// LEFT JOIN LATERAL: cari nama zona (kalau ada) yang memuat titik laporan ini
const ZONE_JOIN =
  'LEFT JOIN LATERAL (' +
  '  SELECT name FROM zones WHERE ST_Covers(zones.geom, r.geom) LIMIT 1' +
  ') zr ON true';

// Middleware: hanya lanjut kalau header x-admin-key cocok dengan ADMIN_KEY di .env
const requireAuth = require('../middleware/auth');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Ekstensi ditentukan server dari jenis file, bukan dari nama file buatan pengguna
const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
      cb(null, crypto.randomUUID() + EXT_BY_MIME[file.mimetype]);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    if (!EXT_BY_MIME[file.mimetype]) {
      return cb(new Error('Foto harus berformat JPG, PNG, atau WEBP'));
    }
    cb(null, true);
  }
});

// Membungkus multer agar error upload dikembalikan sebagai JSON yang rapi
function handleUpload(req, res, next) {
  upload.single('photo')(req, res, function (err) {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran foto maksimal 2 MB' : err.message;
      return res.status(400).json({ message: msg });
    }
    next();
  });
}

function removeFile(filePath) {
  if (filePath) {
    fs.unlink(filePath, function () {});
  }
}

// Ubah satu baris hasil query menjadi GeoJSON Feature
function toFeature(row) {
  const properties = {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    status: row.status,
    photo_url: row.photo_url,
    zone_name: row.zone_name || null,
    created_at: row.created_at,
  };
  if (row.distance !== undefined) {
    properties.distance = Math.round(row.distance);
  }
  return {
    type: 'Feature',
    geometry: JSON.parse(row.geometry),
    properties: properties,
  };
}

// GET /api/reports?category=jalan (category opsional)
router.get('/', readLimiter, async (req, res) => {
  const category = req.query.category;

  if (category && !CATEGORIES.includes(category)) {
    return res.status(400).json({ message: 'Kategori tidak valid' });
  }

  let sql = 'SELECT ' + SELECT_COLUMNS + ' FROM reports r ' + ZONE_JOIN;
  const params = [];

  if (category) {
    sql += ' WHERE r.category = $1';
    params.push(category);
  }
  sql += ' ORDER BY r.created_at DESC';

  try {
    const result = await pool.query(sql, params);
    res.json({
      type: 'FeatureCollection',
      features: result.rows.map(toFeature),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal mengambil data laporan' });
  }
});

// GET /api/reports/in-view?minLng=..&minLat=..&maxLng=..&maxLat=..&category=..
router.get('/in-view', readLimiter, async (req, res) => {
  const minLng = Number(req.query.minLng);
  const minLat = Number(req.query.minLat);
  const maxLng = Number(req.query.maxLng);
  const maxLat = Number(req.query.maxLat);
  const category = req.query.category;

  const coords = [minLng, minLat, maxLng, maxLat];
  if (coords.some(function (v) { return !Number.isFinite(v); })) {
    return res.status(400).json({ message: 'Parameter bounding box tidak lengkap atau tidak valid' });
  }
  if (minLng >= maxLng || minLat >= maxLat) {
    return res.status(400).json({ message: 'Bounding box tidak valid' });
  }
  if (category && !CATEGORIES.includes(category)) {
    return res.status(400).json({ message: 'Kategori tidak valid' });
  }

  const params = [minLng, minLat, maxLng, maxLat];
  let sql =
    'SELECT ' + SELECT_COLUMNS + ' FROM reports r ' + ZONE_JOIN +
    ' WHERE r.geom && ST_MakeEnvelope($1::float8, $2::float8, $3::float8, $4::float8, 4326)';

  if (category) {
    sql += ' AND r.category = $5';
    params.push(category);
  }
  sql += ' ORDER BY r.created_at DESC LIMIT 500';

  try {
    const result = await pool.query(sql, params);
    res.json({
      type: 'FeatureCollection',
      features: result.rows.map(toFeature),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal mengambil laporan pada area ini' });
  }
});

// GET /api/reports/nearby?lat=..&lng=..&radius=..&category=.. (radius dalam meter)
router.get('/nearby', readLimiter, async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Number(req.query.radius);
  const category = req.query.category;

  if (!isValidLat(lat)) {
    return res.status(400).json({ message: 'Latitude tidak valid' });
  }
  if (!isValidLat(lat)) {
    return res.status(400).json({ message: 'Longitude tidak valid' });
  }
  if (!Number.isFinite(radius) || radius <= 0 || radius > 50000) {
    return res.status(400).json({ message: 'Radius harus antara 1 dan 50000 meter' });
  }
  if (category && !CATEGORIES.includes(category)) {
    return res.status(400).json({ message: 'Kategori tidak valid' });
  }

  const params = [lng, lat, radius];
  let sql =
    'SELECT ' + SELECT_COLUMNS + ', ' +
    'ST_Distance(r.geom::geography, ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography) AS distance ' +
    'FROM reports r ' + ZONE_JOIN +
    ' WHERE ST_DWithin(r.geom::geography, ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography, $3::float8)';

  if (category) {
    sql += ' AND r.category = $4';
    params.push(category);
  }
  sql += ' ORDER BY distance';

  try {
    const result = await pool.query(sql, params);
    res.json({
      type: 'FeatureCollection',
      features: result.rows.map(toFeature),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal mencari laporan' });
  }
});

// GET /api/reports/closest?lat=..&lng=..&limit=5&category=.. (limit dan category opsional)
router.get('/closest', readLimiter, async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const limit = req.query.limit === undefined ? 5 : Number(req.query.limit);
  const category = req.query.category;

  if (!isValidLat(lat)) {
    return res.status(400).json({ message: 'Latitude tidak valid' });
  }
  if (!isValidLat(lat)) {
    return res.status(400).json({ message: 'Longitude tidak valid' });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    return res.status(400).json({ message: 'Limit harus bilangan bulat antara 1 dan 20' });
  }
  if (category && !CATEGORIES.includes(category)) {
    return res.status(400).json({ message: 'Kategori tidak valid' });
  }

  const params = [lng, lat, limit];
  let sql =
    'SELECT ' + SELECT_COLUMNS + ', ' +
    'ST_Distance(r.geom::geography, ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography) AS distance ' +
    'FROM reports r ' + ZONE_JOIN;

  if (category) {
    sql += ' WHERE r.category = $4';
    params.push(category);
  }

  sql +=
    ' ORDER BY r.geom::geography <-> ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography' +
    ' LIMIT $3::int';

  try {
    const result = await pool.query(sql, params);
    res.json({
      type: 'FeatureCollection',
      features: result.rows.map(toFeature),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal mencari laporan terdekat' });
  }
});

// POST /api/reports : tambah laporan baru (multipart/form-data, foto opsional)
router.post('/', handleUpload, async (req, res) => {
  const { title, description, category } = req.body;
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  const file = req.file;

  // Kalau validasi gagal, foto yang sudah terlanjur tersimpan harus dihapus
  function reject(message) {
    if (file) {
      removeFile(file.path);
    }
    return res.status(400).json({ message: message });
  }

  if (!title || typeof title !== 'string' || title.trim() === '') {
    return reject('Judul wajib diisi');
  }
  if (!CATEGORIES.includes(category)) {
    return reject('Kategori harus salah satu dari: ' + CATEGORIES.join(', '));
  }
  if (!isValidLat(lat)) {
    return reject('Latitude harus angka antara -90 dan 90');
  }
  if (!isValidLat(lat)) {
    return reject('Longitude harus angka antara -180 dan 180');
  }

  const photoUrl = file ? '/uploads/' + file.filename : null;

  try {
    const result = await pool.query(
      'WITH inserted AS (' +
      '  INSERT INTO reports (title, description, category, photo_url, geom) ' +
      '  VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5::float8, $6::float8), 4326)) ' +
      '  RETURNING *' +
      ') ' +
      'SELECT ' + SELECT_COLUMNS + ' FROM inserted r ' + ZONE_JOIN,
      [title.trim(), description || null, category, photoUrl, lng, lat]
    );
    res.status(201).json(toFeature(result.rows[0]));
  } catch (err) {
    if (file) {
      removeFile(file.path);
    }
    console.error(err);
    res.status(500).json({ message: 'Gagal menyimpan laporan' });
  }
});

// PATCH /api/reports/:id/status : ubah status laporan
router.patch('/:id/status', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status;

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'ID tidak valid' });
  }
  if (!STATUSES.includes(status)) {
    return res.status(400).json({
      message: 'Status harus salah satu dari: ' + STATUSES.join(', '),
    });
  }

  try {
    const result = await pool.query(
      'WITH updated AS (' +
      '  UPDATE reports SET status = $1 WHERE id = $2 RETURNING *' +
      ') ' +
      'SELECT ' + SELECT_COLUMNS + ' FROM updated r ' + ZONE_JOIN,
      [status, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Laporan tidak ditemukan' });
    }
    res.json(toFeature(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal mengubah status' });
  }
});

// DELETE /api/reports/:id : hapus laporan (beserta fotonya)
router.delete('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'ID tidak valid' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM reports WHERE id = $1 RETURNING photo_url',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Laporan tidak ditemukan' });
    }

    const photoUrl = result.rows[0].photo_url;
    if (photoUrl) {
      removeFile(path.join(UPLOAD_DIR, path.basename(photoUrl)));
    }

    res.json({ message: 'Laporan dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal menghapus laporan' });
  }
});

// GET /api/reports/stats : ringkasan jumlah laporan per kategori dan status
router.get('/stats', readLimiter, async (req, res) => {
  try {
    const byCategory = await pool.query(
      'SELECT category, COUNT(*)::int AS total FROM reports GROUP BY category ORDER BY total DESC'
    );
    const byStatus = await pool.query(
      'SELECT status, COUNT(*)::int AS total FROM reports GROUP BY status ORDER BY total DESC'
    );
    const totalResult = await pool.query('SELECT COUNT(*)::int AS total FROM reports');

    res.json({
      total: totalResult.rows[0].total,
      byCategory: byCategory.rows,
      byStatus: byStatus.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal mengambil statistik' });
  }
});

// GET /api/reports/:id : detail satu laporan
router.get('/:id', readLimiter, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'ID tidak valid' });
  }

  try {
    const result = await pool.query(
      'SELECT ' + SELECT_COLUMNS + ' FROM reports r ' + ZONE_JOIN + ' WHERE r.id = $1',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Laporan tidak ditemukan' });
    }
    res.json(toFeature(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal mengambil laporan' });
  }
});



module.exports = router;