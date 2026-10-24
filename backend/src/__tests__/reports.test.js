const request = require('supertest');
const app = require('../server');

describe('POST /api/reports - validasi', () => {
  test('menolak tanpa judul', async () => {
    const res = await request(app)
      .post('/api/reports')
      .field('category', 'jalan')
      .field('lat', '-7.9797')
      .field('lng', '112.6304');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/judul/i);
  });

  test('menolak kategori tidak valid', async () => {
    const res = await request(app)
      .post('/api/reports')
      .field('title', 'Tes')
      .field('category', 'bukan-kategori')
      .field('lat', '-7.9797')
      .field('lng', '112.6304');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/kategori/i);
  });

  test('menolak latitude di luar jangkauan', async () => {
    const res = await request(app)
      .post('/api/reports')
      .field('title', 'Tes')
      .field('category', 'jalan')
      .field('lat', '200')
      .field('lng', '112.6304');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/latitude/i);
  });
});

describe('GET /api/reports/nearby - validasi', () => {
  test('menolak tanpa parameter', async () => {
    const res = await request(app).get('/api/reports/nearby');
    expect(res.status).toBe(400);
  });

  test('menolak radius di luar batas', async () => {
    const res = await request(app).get(
      '/api/reports/nearby?lat=-7.9797&lng=112.6304&radius=999999'
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/radius/i);
  });
});

describe('PATCH /api/reports/:id/status - autentikasi', () => {
  test('menolak tanpa token', async () => {
    const res = await request(app)
      .patch('/api/reports/1/status')
      .send({ status: 'diproses' });

    expect(res.status).toBe(401);
  });
});