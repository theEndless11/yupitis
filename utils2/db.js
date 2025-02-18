const mysql = require('mysql2'); // No need for 'mysql2/promise' separately

require('dotenv').config(); // To load environment variables from .env

// Create a connection pool using environment variables
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 100, // Number of connections allowed in the pool
  queueLimit: 0 // Unlimited queue length
});

// Explicitly call .promise() to enable promise-based queries
const promisePool = pool.promise(); // Here, ensure this line is included

// Export the promise-enabled pool
module.exports = promisePool; // Export promisePool