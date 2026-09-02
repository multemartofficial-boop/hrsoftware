const pool = require('../config/database');
const { sendEmail } = require('./email');

// Check for expiring workers and send notifications
const checkExpiringWorkers = async () => {
  try {
    const today = new Date();
    
    // Calculate dates for warnings
    const oneMonthFromNow = new Date(today);
    oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
    
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    
    // Check for workers expiring in exactly one month
    const [oneMonthExpiring] = await pool.query(
      `SELECT id, name, email, expiry 
       FROM workers 
       WHERE status = 'active' 
       AND on_leave = false
       AND DATE(expiry) = DATE(?)`,
      [oneMonthFromNow.toISOString().split('T')[0]]
    );
    
    // Check for workers expiring in exactly seven days
    const [sevenDaysExpiring] = await pool.query(
      `SELECT id, name, email, expiry 
       FROM workers 
       WHERE status = 'active' 
       AND on_leave = false
       AND DATE(expiry) = DATE(?)`,
      [sevenDaysFromNow.toISOString().split('T')[0]]
    );
    
    // Send 1-month warning emails
    for (const worker of oneMonthExpiring) {
      await sendEmail({
        to: 'admin@workhr.com', // In production, get admin email from settings
        subject: `Worker Expiry Warning: ${worker.name} (${worker.id}) expires in 1 month`,
        html: `
          <h2>Worker Expiry Warning</h2>
          <p>Worker <strong>${worker.name}</strong> (<strong>${worker.id}</strong>) expires in 1 month.</p>
          <p><strong>Expiry Date:</strong> ${worker.expiry}</p>
          <p>Please take appropriate action to renew or deactivate this worker.</p>
        `,
        text: `Worker ${worker.name} (${worker.id}) expires in 1 month on ${worker.expiry}.`
      });
      
      console.log(`1-month expiry warning sent for worker ${worker.id}`);
    }
    
    // Send 7-day warning emails
    for (const worker of sevenDaysExpiring) {
      await sendEmail({
        to: 'admin@workhr.com', // In production, get admin email from settings
        subject: `URGENT: Worker Expiry Warning: ${worker.name} (${worker.id}) expires in 7 days`,
        html: `
          <h2>URGENT: Worker Expiry Warning</h2>
          <p>Worker <strong>${worker.name}</strong> (<strong>${worker.id}</strong>) expires in 7 days.</p>
          <p><strong>Expiry Date:</strong> ${worker.expiry}</p>
          <p>Please take immediate action to renew or deactivate this worker.</p>
        `,
        text: `URGENT: Worker ${worker.name} (${worker.id}) expires in 7 days on ${worker.expiry}.`
      });
      
      console.log(`7-day expiry warning sent for worker ${worker.id}`);
    }
    
    // Automatically update expired workers
    const [expiredWorkers] = await pool.query(
      `UPDATE workers 
       SET status = 'expired' 
       WHERE expiry < CURDATE() 
       AND status != 'expired'`
    );
    
    if (expiredWorkers.affectedRows > 0) {
      console.log(`Automatically expired ${expiredWorkers.affectedRows} workers`);
    }
    
    return {
      oneMonthCount: oneMonthExpiring.length,
      sevenDaysCount: sevenDaysExpiring.length,
      expiredCount: expiredWorkers.affectedRows
    };
  } catch (error) {
    console.error('Expiry check error:', error);
    throw error;
  }
};

module.exports = { checkExpiringWorkers };