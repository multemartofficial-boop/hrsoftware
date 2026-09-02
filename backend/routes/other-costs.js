const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Generate other cost ID
const generateOtherCostId = () => {
  return `COST-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
};

// Admin: Get all other costs
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    
    let query = 'SELECT * FROM other_costs';
    const params = [];
    const conditions = [];
    
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
    
    const [costs] = await pool.query(query, params);
    res.json(costs);
  } catch (error) {
    console.error('Get other costs error:', error);
    res.status(500).json({ error: true, message: 'Failed to load other costs' });
  }
});

// Admin: Create other cost
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { description, amount, date } = req.body;
    const costId = generateOtherCostId();
    
    await pool.query(
      'INSERT INTO other_costs (id, description, amount, date) VALUES (?, ?, ?, ?)',
      [costId, description, amount, date]
    );

    res.status(201).json({ id: costId, message: 'Other cost added successfully' });
  } catch (error) {
    console.error('Create other cost error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Update other cost
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { description, amount, date } = req.body;
    
    await pool.query(
      'UPDATE other_costs SET description = ?, amount = ?, date = ? WHERE id = ?',
      [description, amount, date, req.params.id]
    );

    res.json({ message: 'Other cost updated successfully' });
  } catch (error) {
    console.error('Update other cost error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Delete other cost
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM other_costs WHERE id = ?', [req.params.id]);
    res.json({ message: 'Other cost deleted successfully' });
  } catch (error) {
    console.error('Delete other cost error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
