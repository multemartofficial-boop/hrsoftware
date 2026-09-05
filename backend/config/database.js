const mysql = require('mysql2/promise');

// Serverless-safe pool: cache the pool on globalThis so warm invocations reuse
// it instead of opening new connections on every request. Each Vercel function
// instance is a separate process, so per-instance limits must stay small —
// Hostinger shared MySQL allows a limited number of concurrent connections.
const isServerless = Boolean(process.env.VERCEL);

if (!globalThis.__hrDbPool) {
  globalThis.__hrDbPool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: isServerless ? 3 : 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    dateStrings: true // Return dates as strings instead of Date objects
  });
}

const pool = globalThis.__hrDbPool;

// Test connection (best-effort; logs only)
pool.getConnection()
  .then(connection => {
    console.log('Database connected successfully');
    connection.release();
  })
  .catch(err => {
    console.error('Database connection failed:');
    console.error('Error message:', err.message);
    console.error('Error code:', err.code);
    console.error('Error number:', err.errno);
    console.error('SQL state:', err.sqlState);
  });

module.exports = pool;
