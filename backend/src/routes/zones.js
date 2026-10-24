const { readLimiter } = require('../middleware/rateLimiters');
const express = require('express');
const pool = require('../db');

const router = express.Router();

const LEVELS = ['rawan_banjir', 'rawan_macet', 'rawan_sampah', 'rawan_lainnya'];

const requireAuth = require('../middleware/auth');

function toZoneFeature(row) {
  return {
    type: 'Feature',
    geometry: JSON.parse(row.geometry),
    properties: {
      id: row.id,
      name: row.name,
      description: row.description,
      level: row.level,
    },
  };
}

// GET /api/zones : semua area rawan sebagai GeoJSON
router.get('/', readLimiter, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, description, level, ST_AsGeoJSON(geom) AS geometry FROM zones'
    );
    res.json({
      type: 'FeatureCollection',
      features: result.rows.map(toZoneFeature),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal mengambil data zona' });
  }
});

// POST /api/zones : buat zona baru dari poligon yang digambar di peta
router.post('/', requireAuth, async (req, res) => {
  const { name, description, level, geometry } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ message: 'Nama zona wajib diisi' });
  }
  if (!LEVELS.includes(level)) {
    return res.status(400).json({ message: 'Level harus salah satu dari: ' + LEVELS.join(', ') });
  }
  if (!geometry || geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) {
    return res.status(400).json({ message: 'Geometri poligon tidak valid' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO zones (name, description, level, geom) ' +
      'VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)) ' +
      'RETURNING id, name, description, level, ST_AsGeoJSON(geom) AS geometry',
      [name.trim(), description || null, level, JSON.stringify(geometry)]
    );
    res.status(201).json(toZoneFeature(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal menyimpan zona. Pastikan poligon valid (tidak berpotongan sendiri)' });
  }
});

// PATCH /api/zones/:id : ubah nama, deskripsi, atau level zona (bukan bentuknya)
router.patch('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { name, description, level } = req.body;

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'ID tidak valid' });
  }
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ message: 'Nama zona wajib diisi' });
  }
  if (!LEVELS.includes(level)) {
    return res.status(400).json({ message: 'Level harus salah satu dari: ' + LEVELS.join(', ') });
  }

  try {
    const result = await pool.query(
      'UPDATE zones SET name = $1, description = $2, level = $3 WHERE id = $4 ' +
      'RETURNING id, name, description, level, ST_AsGeoJSON(geom) AS geometry',
      [name.trim(), description || null, level, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Zona tidak ditemukan' });
    }
    res.json(toZoneFeature(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal mengubah zona' });
  }
});

// DELETE /api/zones/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'ID tidak valid' });
  }

  try {
    const result = await pool.query('DELETE FROM zones WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Zona tidak ditemukan' });
    }
    res.json({ message: 'Zona dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal menghapus zona' });
  }
});

module.exports = router;