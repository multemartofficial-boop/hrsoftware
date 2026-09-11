const pool = require('../config/database');

// Record a meaningful state-changing action in the action_logs audit table.
// Never throws — a logging failure must not break the request being logged.
const logAction = async (actorType, actorId, actorName, action, targetType, targetId, details) => {
  try {
    await pool.query(
      `INSERT INTO action_logs (actor_type, actor_id, actor_name, action, target_type, target_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ['admin', 'worker', 'system'].includes(actorType) ? actorType : 'system',
        actorId != null ? String(actorId) : null,
        actorName != null ? String(actorName) : null,
        String(action),
        targetType != null ? String(targetType) : null,
        targetId != null ? String(targetId) : null,
        details != null ? JSON.stringify(details) : null,
      ]
    );
  } catch (error) {
    console.error(`[action-log] failed to record "${action}":`, error.message);
  }
};

// Convenience wrapper: pulls actor info (role/id/name) from req.user set by requireAuth.
const logActionFromReq = (req, action, targetType, targetId, details) => {
  const u = req.user || {};
  return logAction(
    u.role,
    u.userId ?? u.workerId ?? null,
    u.name || u.email || null,
    action,
    targetType,
    targetId,
    details
  );
};

module.exports = { logAction, logActionFromReq };
