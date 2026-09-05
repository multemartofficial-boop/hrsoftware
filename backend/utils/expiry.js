const pool = require('../config/database');
const { sendEmail } = require('./email');

// Check for expiring workers and send notifications
const checkExpiringWorkers = async () => {
  try {
    const today = new Date();
    const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    
    // Calculate dates for warnings using UTC to match database DATE comparison
    const oneMonthFromNow = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth() + 1, todayUTC.getUTCDate()));
    const sevenDaysFromNow = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), todayUTC.getUTCDate() + 7));
    
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
    
    // Send 1-month warning emails and create in-app notifications
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
      
      // Create in-app notification (handle foreign key constraint gracefully)
      try {
        await pool.query(
          'INSERT INTO notifications (id, worker, worker_id, message, urgency, occurred_at) VALUES (?, ?, ?, ?, "warning", "Just now")',
          [`N-${Date.now()}-${worker.id}`, worker.name, worker.id, `Worker ${worker.name} (${worker.id}) expires in 1 month`]
        );
      } catch (notificationError) {
        // If foreign key constraint fails, try without worker_id
        if (notificationError.code === 'ER_NO_REFERENCED_ROW_2') {
          await pool.query(
            'INSERT INTO notifications (id, worker, message, urgency, occurred_at) VALUES (?, ?, ?, "warning", "Just now")',
            [`N-${Date.now()}-${worker.id}`, worker.name, `Worker ${worker.name} (${worker.id}) expires in 1 month`]
          );
        } else {
          console.error('Failed to create notification for worker:', worker.id, notificationError.message);
        }
      }
      
      console.log(`1-month expiry warning sent for worker ${worker.id}`);
    }
    
    // Send 7-day warning emails and create in-app notifications
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
      
      // Create in-app notification (handle foreign key constraint gracefully)
      try {
        await pool.query(
          'INSERT INTO notifications (id, worker, worker_id, message, urgency, occurred_at) VALUES (?, ?, ?, ?, "critical", "Just now")',
          [`N-${Date.now()}-${worker.id}`, worker.name, worker.id, `URGENT: Worker ${worker.name} (${worker.id}) expires in 7 days`]
        );
      } catch (notificationError) {
        // If foreign key constraint fails, try without worker_id
        if (notificationError.code === 'ER_NO_REFERENCED_ROW_2') {
          await pool.query(
            'INSERT INTO notifications (id, worker, message, urgency, occurred_at) VALUES (?, ?, ?, "critical", "Just now")',
            [`N-${Date.now()}-${worker.id}`, worker.name, `URGENT: Worker ${worker.name} (${worker.id}) expires in 7 days`]
          );
        } else {
          console.error('Failed to create notification for worker:', worker.id, notificationError.message);
        }
      }
      
      console.log(`7-day expiry warning sent for worker ${worker.id}`);
    }

    // ---------------- Visa expiry alerts (Phase E) ----------------
    // Check every active worker with a visa_expiry on file. A persistent
    // notification is created when the days-left count crosses one of the
    // threshold marks below; the deterministic notification id dedupes
    // re-runs on the same threshold day.
    const VISA_THRESHOLDS = [90, 60, 30, 14, 7, 3, 1, 0];
    const [visaWorkers] = await pool.query(
      `SELECT id, name, email, visa_expiry
       FROM workers
       WHERE status = 'active' AND visa_expiry IS NOT NULL`
    );

    for (const worker of visaWorkers) {
      const expiry = new Date(worker.visa_expiry);
      const expiryUTC = new Date(Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate()));
      const daysLeft = Math.ceil((expiryUTC - todayUTC) / (1000 * 60 * 60 * 24));

      // Notify on exact threshold hits, or daily once expired/last day
      const hit = VISA_THRESHOLDS.includes(daysLeft) || daysLeft < 0;
      if (!hit) continue;

      const notifId = `VISA-${worker.id}-D${daysLeft}`;
      const urgency = daysLeft <= 7 ? 'critical' : 'warning';
      const message = daysLeft < 0
        ? `Visa EXPIRED ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago — ${worker.name} cannot legally continue working, action required`
        : `${worker.name}'s visa expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — expired visas cannot legally continue working, action required`;

      // Deterministic ID → duplicate insert on the same day is skipped
      try {
        await pool.query(
          'INSERT INTO notifications (id, worker, worker_id, message, urgency, occurred_at) VALUES (?, ?, ?, ?, ?, "Just now")',
          [notifId, worker.name, worker.id, `[Visa] ${message}`, urgency]
        );
        console.log(`Visa expiry alert created for ${worker.id} (${daysLeft} days left)`);

        await sendEmail({
          to: 'admin@workhr.com',
          subject: `VISA EXPIRY: ${worker.name} (${worker.id}) — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`,
          html: `<h2>Visa Expiry Alert</h2><p>${message}</p><p><strong>Visa Expiry Date:</strong> ${worker.visa_expiry}</p>`,
          text: `VISA: ${message}`
        });
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY') {
          console.error(`Failed to create visa notification for ${worker.id}:`, e.message);
        }
      }
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