const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Generate location ID
const generateLocationId = () => {
  return `LOC-${Date.now()}`;
};

// Public: Get all locations (for registration form)
router.get('/', async (req, res) => {
  try {
    const [locations] = await pool.query('SELECT * FROM locations ORDER BY name');
    res.json(locations);
  } catch (error) {
    console.error('Get locations error:', error);
    res.status(500).json({ error: true, message: 'Failed to load locations' });
  }
});

// Admin: Create location
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, address } = req.body;
    const locationId = generateLocationId();
    
    await pool.query(
      'INSERT INTO locations (id, name, address) VALUES (?, ?, ?)',
      [locationId, name, address]
    );

    res.status(201).json({ id: locationId, message: 'Location created successfully' });
  } catch (error) {
    console.error('Create location error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Update location
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { name, address } = req.body;
    
    // Get old location name for updating workers
    const [oldLocation] = await connection.query(
      'SELECT name FROM locations WHERE id = ?',
      [req.params.id]
    );
    
    if (oldLocation.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Location not found' });
    }
    
    const oldName = oldLocation[0].name;
    
    // Update location
    await connection.query(
      'UPDATE locations SET name = ?, address = ? WHERE id = ?',
      [name, address, req.params.id]
    );
    
    // Update workers if location name changed
    if (name !== oldName) {
      await connection.query(
        'UPDATE workers SET location = ? WHERE location = ?',
        [name, oldName]
      );
      
      await connection.query(
        'UPDATE attendance SET location = ? WHERE location = ?',
        [name, oldName]
      );
    }
    
    await connection.commit();
    res.json({ message: 'Location updated successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Update location error:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    connection.release();
  }
});

// Admin: Delete location
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM locations WHERE id = ?', [req.params.id]);
    res.json({ message: 'Location deleted successfully' });
  } catch (error) {
    console.error('Delete location error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get workers count by location
router.get('/:name/workers-count', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [count] = await pool.query(
      'SELECT COUNT(*) as count FROM workers WHERE location = ?',
      [req.params.name]
    );
    res.json({ count: count[0].count });
  } catch (error) {
    console.error('Get workers count error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
