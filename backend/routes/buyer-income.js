const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Generate buyer income ID
const generateBuyerIncomeId = () => {
  return `BIN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
};

// Admin: Get all buyer income
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { buyer, status, from, to } = req.query;
    
    let query = 'SELECT * FROM buyer_income';
    const params = [];
    const conditions = [];
    
    if (buyer && buyer !== 'all') {
      conditions.push('buyer_name = ?');
      params.push(buyer);
    }
    
    if (status && status !== 'all') {
      conditions.push('status = ?');
      params.push(status);
    }
    
    if (from) {
      conditions.push('date >= ?');
      params.push(from);
    }
    
    if (to) {
      conditions.push('date <= ?');
      params.push(to);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY date DESC';
    
    const [income] = await pool.query(query, params);
    // Transform buyer_name to buyer for frontend compatibility
    const transformed = income.map(row => ({
      ...row,
      buyer: row.buyer_name
    }));
    res.json(transformed);
  } catch (error) {
    console.error('Get buyer income error:', error);
    res.status(500).json({ error: true, message: 'Failed to load buyer income records' });
  }
});

// Admin: Create buyer income
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { buyer, buyerName, description, amount, date, status } = req.body;
    // Accept both 'buyer' (frontend) and 'buyerName' for compatibility
    const buyerNameFinal = buyer || buyerName;
    const incomeId = generateBuyerIncomeId();
    
    await pool.query(
      `INSERT INTO buyer_income (id, buyer_name, description, amount, date, status) 
      VALUES (?, ?, ?, ?, ?, ?)`,
      [incomeId, buyerNameFinal, description, amount, date, status || 'Pending']
    );

    // Log notification
    await pool.query(
      'INSERT INTO notifications (id, worker, message, urgency, occurred_at) VALUES (?, ?, ?, "info", "Just now")',
      [`N-${Date.now()}`, buyerNameFinal, `Buyer payment logged — ${description}`]
    );

    res.status(201).json({ id: incomeId, message: 'Buyer income added successfully' });
  } catch (error) {
    console.error('Create buyer income error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Update buyer income
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { buyer, buyerName, description, amount, date, status } = req.body;
    // Accept both 'buyer' (frontend) and 'buyerName' for compatibility
    const buyerNameFinal = buyer || buyerName;
    
    await pool.query(
      `UPDATE buyer_income 
      SET buyer_name = ?, description = ?, amount = ?, date = ?, status = ? 
      WHERE id = ?`,
      [buyerNameFinal, description, amount, date, status, req.params.id]
    );

    res.json({ message: 'Buyer income updated successfully' });
  } catch (error) {
    console.error('Update buyer income error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Delete buyer income
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM buyer_income WHERE id = ?', [req.params.id]);
    res.json({ message: 'Buyer income deleted successfully' });
  } catch (error) {
    console.error('Delete buyer income error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get unique buyer names
router.get('/buyers/list', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [buyers] = await pool.query(
      'SELECT DISTINCT buyer_name FROM buyer_income ORDER BY buyer_name'
    );
    res.json(buyers.map(b => b.buyer_name));
  } catch (error) {
    console.error('Get buyers list error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
