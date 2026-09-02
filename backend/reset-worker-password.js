const pool = require('./config/database');
const bcrypt = require('bcryptjs');

async function resetPassword() {
  try {
    const workerId = 'WKR-2026-0147';
    const newPassword = 'worker123';
    
    // Hash the new password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    
    // Update the worker's password
    await pool.query(
      'UPDATE workers SET password_hash = ? WHERE id = ?',
      [passwordHash, workerId]
    );
    
    console.log(`Password reset successfully for worker ${workerId}`);
    console.log(`New password: ${newPassword}`);
    
    // Verify the update
    const [workers] = await pool.query(
      'SELECT id, name, password_hash FROM workers WHERE id = ?',
      [workerId]
    );
    
    if (workers.length > 0) {
      console.log('Worker details:', {
        id: workers[0].id,
        name: workers[0].name,
        hasPasswordHash: !!workers[0].password_hash
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

resetPassword();