const pool = require('./config/database');

async function checkWorker() {
  try {
    const [workers] = await pool.query(
      'SELECT id, name, email, password_hash, status FROM workers WHERE id = ?',
      ['WKR-2026-0147']
    );
    
    if (workers.length === 0) {
      console.log('Worker WKR-2026-0147 NOT FOUND in database');
    } else {
      console.log('Worker found:');
      console.log('ID:', workers[0].id);
      console.log('Name:', workers[0].name);
      console.log('Email:', workers[0].email);
      console.log('Status:', workers[0].status);
      console.log('Password hash exists:', !!workers[0].password_hash);
      console.log('Password hash:', workers[0].password_hash ? workers[0].password_hash.substring(0, 20) + '...' : 'NULL');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkWorker();