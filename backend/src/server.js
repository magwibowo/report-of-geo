require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT PostGIS_Version() AS postgis');
    res.json({ status: 'ok', postgis: result.rows[0].postgis });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

const https = require('https');

// GET /api/geocode/reverse?lat=..&lng=.. : proxy ke LocationIQ
app.get('/api/geocode/reverse', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return res.status(400).json({ message: 'Latitude tidak valid' });
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ message: 'Longitude tidak valid' });
  }
  if (!process.env.LOCATIONIQ_KEY) {
    return res.status(500).json({ message: 'LOCATIONIQ_KEY belum diatur di .env' });
  }

  const url =
    'https://us1.locationiq.com/v1/reverse?key=' + process.env.LOCATIONIQ_KEY +
    '&lat=' + lat + '&lon=' + lng + '&format=json&addressdetails=1';

  try {
    const response = await fetch(url);

    if (!response.ok) {
      const bodyText = await response.text();
      console.error('LocationIQ status:', response.status, bodyText);
      return res.status(502).json({ message: 'Layanan geocoding sedang tidak merespons' });
    }

    const data = await response.json();
    res.json({
      display_name: data.display_name || null,
      road: data.address ? data.address.road : null,
      village: data.address ? (data.address.village || data.address.suburb) : null,
      city: data.address ? (data.address.city || data.address.town || data.address.county) : null,
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ message: 'Gagal menghubungi layanan geocoding' });
  }
});

const reportsRouter = require('./routes/reports');
app.use('/api/reports', reportsRouter);

const zonesRouter = require('./routes/zones');
app.use('/api/zones', zonesRouter);
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), {
  setHeaders: function (res) {
    res.set('X-Content-Type-Options', 'nosniff');
  }
}));

const authRouter = require('./routes/auth');
app.use('/api/auth', authRouter);

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('Server jalan di http://localhost:' + PORT);
  });
}

module.exports = app;