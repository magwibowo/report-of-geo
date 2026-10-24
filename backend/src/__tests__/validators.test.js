const { isValidLat, isValidLng, isValidCategory, isValidStatus } = require('../validators');

describe('isValidLat', () => {
  test('menerima latitude valid', () => {
    expect(isValidLat(-7.9797)).toBe(true);
    expect(isValidLat(0)).toBe(true);
    expect(isValidLat(90)).toBe(true);
    expect(isValidLat(-90)).toBe(true);
  });

  test('menolak latitude di luar jangkauan', () => {
    expect(isValidLat(91)).toBe(false);
    expect(isValidLat(-91)).toBe(false);
  });

  test('menolak nilai bukan angka', () => {
    expect(isValidLat(NaN)).toBe(false);
    expect(isValidLat(undefined)).toBe(false);
  });
});

describe('isValidLng', () => {
  test('menerima longitude valid', () => {
    expect(isValidLng(112.6304)).toBe(true);
    expect(isValidLng(180)).toBe(true);
    expect(isValidLng(-180)).toBe(true);
  });

  test('menolak longitude di luar jangkauan', () => {
    expect(isValidLng(181)).toBe(false);
    expect(isValidLng(-181)).toBe(false);
  });
});

describe('isValidCategory', () => {
  test('menerima kategori yang terdaftar', () => {
    expect(isValidCategory('jalan')).toBe(true);
    expect(isValidCategory('drainase')).toBe(true);
  });

  test('menolak kategori yang tidak dikenal', () => {
    expect(isValidCategory('sampahluarangkasa')).toBe(false);
    expect(isValidCategory('')).toBe(false);
  });
});

describe('isValidStatus', () => {
  test('menerima status yang terdaftar', () => {
    expect(isValidStatus('pending')).toBe(true);
    expect(isValidStatus('selesai')).toBe(true);
  });

  test('menolak status tidak dikenal', () => {
    expect(isValidStatus('batal')).toBe(false);
  });
});