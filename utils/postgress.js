const { Pool } = require('pg');

const pool = new Pool({
  user: 'socketio',
  host: 'mnz.domcloud.co',
  database: 'socketio_msg',
  password: 'zK2(j6)Mn6sOzL)87W',
  port: 5432,
  max: 100,
  idleTimeoutMillis: 30000,
  ssl: false // 🔴 Fully disable SSL to avoid the error
});

pool.on('error', (err) => {
  console.error('Postgres idle client error', err);
});

module.exports = pool;
