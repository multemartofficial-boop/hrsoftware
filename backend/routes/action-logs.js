const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Admin: List action log entries, newest first.
// Filters: from, to (YYYY-MM-DD), actor (name or id substring), action (exact),
// actorType (admin|worker|system), q (free-text over action/target/details).
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { from, to, actor, action, actorType, q } = req.query;

    const conditions = [];
    const params = [];

    if (from && /^\d{4}-\d{2}-\d{2}$/.test(String(from))) {
      conditions.push('created_at >= ?');
      params.push(`${from} 00:00:00`);
    }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(String(to))) {
      conditions.push('created_at <= ?');
      params.push(`${to} 23:59:59`);
    }
    if (actor) {
      conditions.push('(actor_name LIKE ? OR actor_id LIKE ?)');
      params.push(`%${actor}%`, `%${actor}%`);
    }
    if (action) {
      conditions.push('action = ?');
      params.push(String(action));
    }
    if (actorType && ['admin', 'worker', 'system'].includes(actorType)) {
      conditions.push('actor_type = ?');
      params.push(actorType);
    }
    if (q) {
      conditions.push('(action LIKE ? OR target_type LIKE ? OR target_id LIKE ? OR details LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    const [rows] = await pool.query(
      `SELECT id, actor_type, actor_id, actor_name, action, target_type, target_id, details, created_at
       FROM action_logs${where} ORDER BY created_at DESC, id DESC LIMIT 500`,
      params
    );

    res.json(rows.map(r => ({
      id: r.id,
      actorType: r.actor_type,
      actorId: r.actor_id,
      actorName: r.actor_name,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      details: typeof r.details === 'string' ? JSON.parse(r.details || 'null') : r.details,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    })));
  } catch (error) {
    console.error('Get action logs error:', error);
    res.status(500).json({ error: 'Failed to load action history' });
  }
});

// Admin: Distinct action values present in the log (for the filter dropdown)
router.get('/actions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT DISTINCT action FROM action_logs ORDER BY action');
    res.json(rows.map(r => r.action));
  } catch (error) {
    console.error('Get action types error:', error);
    res.status(500).json({ error: 'Failed to load action types' });
  }
});

module.exports = router;
