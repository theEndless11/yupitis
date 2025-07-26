const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'srv787.hstgr.io',   // e.g. localhost or a remote MySQL server
  user: 'u208245805_Crypto21',   // Your MySQL username
  password: 'Crypto21@',  // Your MySQL password
  database: 'u208245805_Crypto21',  // Your MySQL database name
  waitForConnections: true,      // Wait for available connection slots
  connectionLimit: 100,           // Max number of connections in the pool
});

module.exports = pool;
