require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./db');

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.error('Pemakaian: node src/create-admin.js <username> <password>');
  process.exit(1);
}

bcrypt.hash(password, 10)
  .then(function (hash) {
    return pool.query(
      'INSERT INTO admins (username, password_hash) VALUES ($1, $2) ' +
      'ON CONFLICT (username) DO UPDATE SET password_hash = $2',
      [username, hash]
    );
  })
  .then(function () {
    console.log('Admin "' + username + '" berhasil dibuat/diperbarui.');
    process.exit(0);
  })
  .catch(function (err) {
    console.error(err);
    process.exit(1);
  });