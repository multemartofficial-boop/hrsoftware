const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const pool = require('../config/database');
const { requireAuth, requireAdmin, requireWorker } = require('../middleware/auth');
const { logActionFromReq } = require('../utils/action-log');
const { saveStoredFile, sendStoredFile, sendLegacyFile, isStoredFileRef, storedFileId } = require('../utils/files');

const CATEGORIES = ['Theft', 'Injury', 'Property Damage', 'Altercation', 'Safety Hazard', 'Other'];
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const STATUSES = ['Open', 'Under Review', 'Resolved', 'Closed'];

// Attachments: same 3MB-per-file limit as registration documents.
// Files are held in memory and written to stored_files so they persist on
// serverless hosts where the filesystem is ephemeral.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|pdf|doc|docx/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('Only images and PDF/Office documents are allowed'));
  }
});

const generateIncidentId = () => `INC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

const parseJson = (v, fallback) => {
  if (v == null) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fallback; } }
  return v;
};

const serialize = (row, { includeNotes = true } = {}) => ({
  id: row.id,
  reportedBy: row.reported_by,
  reporterName: row.reporter_name,
  locationId: row.location_id,
  locationName: row.location_name,
  attendanceId: row.attendance_id,
  category: row.category,
  description: row.description,
  severity: row.severity,
  status: row.status,
  internalNotes: includeNotes ? (parseJson(row.internal_notes, []) || []) : undefined,
  attachments: (parseJson(row.attachments, []) || []).map((a, i) => ({
    index: i, name: a.name, url: a.url,
  })),
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
});

// Worker: Report an incident (multipart; optional `attachments` files ≤3MB each)
router.post('/', requireAuth, requireWorker, upload.array('attachments', 5), async (req, res) => {
  try {
    const { category, locationId, description } = req.body;

    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Category must be one of: ${CATEGORIES.join(', ')}` });
    }
    if (!description || !String(description).trim()) {
      return res.status(400).json({ error: 'A description is required' });
    }

    const [workers] = await pool.query('SELECT name FROM workers WHERE id = ?', [req.user.workerId]);
    if (workers.length === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    const reporterName = workers[0].name;

    // Resolve location name (denormalised so the record survives a location rename/delete)
    let locationName = null;
    if (locationId) {
      const [locs] = await pool.query('SELECT name FROM locations WHERE id = ?', [locationId]);
      if (locs.length === 0) {
        return res.status(400).json({ error: 'Location not found' });
      }
      locationName = locs[0].name;
    }

    // Link today's open shift for this worker, if one exists
    const today = new Date().toISOString().split('T')[0];
    const [shift] = await pool.query(
      'SELECT id FROM attendance WHERE worker_id = ? AND date = ? AND check_out_time IS NULL ORDER BY check_in_time DESC LIMIT 1',
      [req.user.workerId, today]
    );
    const attendanceId = shift[0]?.id || null;

    const attachments = [];
    for (const f of req.files || []) {
      attachments.push({ name: f.originalname, url: `file:${await saveStoredFile(f)}/${encodeURIComponent(f.originalname)}` });
    }

    const id = generateIncidentId();
    await pool.query(
      `INSERT INTO incidents
       (id, reported_by, reporter_name, location_id, location_name, attendance_id,
        category, description, severity, status, internal_notes, attachments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Medium', 'Open', '[]', ?)`,
      [id, req.user.workerId, reporterName, locationId || null, locationName,
       attendanceId, category, String(description).trim(), JSON.stringify(attachments)]
    );

    // In-app admin notification — more urgent for the worker's own severity hint isn't
    // collected at report time, so severity starts Medium and urgency follows category.
    try {
      await pool.query(
        'INSERT INTO notifications (id, worker, worker_id, message, urgency, occurred_at) VALUES (?, ?, ?, ?, ?, "Just now")',
        [`N-INC-${id}`, reporterName, req.user.workerId,
         `New incident reported: ${category}${locationName ? ` at ${locationName}` : ''}`,
         category === 'Injury' || category === 'Altercation' ? 'critical' : 'warning']
      );
    } catch (e) {
      console.error('Incident notification failed:', e.message);
    }

    await logActionFromReq(req, 'reported_incident', 'incident', id, {
      category, location: locationName, linkedShift: attendanceId,
      attachments: attachments.length,
    });

    const [rows] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
    res.status(201).json(serialize(rows[0], { includeNotes: false }));
  } catch (error) {
    console.error('Report incident error:', error);
    res.status(500).json({ error: 'Failed to report incident' });
  }
});

// Worker: List my own incident reports (internal notes are admin-only and stripped)
router.get('/mine', requireAuth, requireWorker, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM incidents WHERE reported_by = ? ORDER BY created_at DESC',
      [req.user.workerId]
    );
    res.json(rows.map(r => serialize(r, { includeNotes: false })));
  } catch (error) {
    console.error('Get my incidents error:', error);
    res.status(500).json({ error: 'Failed to load your incident reports' });
  }
});

// Admin: List incidents — filters: status, severity, locationId, from, to
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, severity, locationId, from, to } = req.query;
    const conditions = [];
    const params = [];

    if (status && STATUSES.includes(status)) { conditions.push('status = ?'); params.push(status); }
    if (severity && SEVERITIES.includes(severity)) { conditions.push('severity = ?'); params.push(severity); }
    if (locationId) { conditions.push('location_id = ?'); params.push(locationId); }
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(String(from))) { conditions.push('created_at >= ?'); params.push(`${from} 00:00:00`); }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(String(to))) { conditions.push('created_at <= ?'); params.push(`${to} 23:59:59`); }

    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    const [rows] = await pool.query(
      `SELECT * FROM incidents${where} ORDER BY created_at DESC LIMIT 500`,
      params
    );
    res.json(rows.map(r => serialize(r)));
  } catch (error) {
    console.error('Get incidents error:', error);
    res.status(500).json({ error: 'Failed to load incidents' });
  }
});

// Admin: Incident detail (includes internal notes)
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM incidents WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    res.json(serialize(rows[0]));
  } catch (error) {
    console.error('Get incident error:', error);
    res.status(500).json({ error: 'Failed to load incident' });
  }
});

// Admin: Update status / severity
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, severity } = req.body;
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}` });
    }
    if (severity !== undefined && !SEVERITIES.includes(severity)) {
      return res.status(400).json({ error: `Severity must be one of: ${SEVERITIES.join(', ')}` });
    }

    const [rows] = await pool.query('SELECT * FROM incidents WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    const prev = rows[0];

    await pool.query(
      'UPDATE incidents SET status = COALESCE(?, status), severity = COALESCE(?, severity) WHERE id = ?',
      [status ?? null, severity ?? null, req.params.id]
    );

    const changes = {};
    if (status && status !== prev.status) changes.status = { from: prev.status, to: status };
    if (severity && severity !== prev.severity) changes.severity = { from: prev.severity, to: severity };
    if (Object.keys(changes).length) {
      await logActionFromReq(req, 'updated_incident', 'incident', req.params.id, {
        category: prev.category, changes,
      });
    }

    const [updated] = await pool.query('SELECT * FROM incidents WHERE id = ?', [req.params.id]);
    res.json(serialize(updated[0]));
  } catch (error) {
    console.error('Update incident error:', error);
    res.status(500).json({ error: 'Failed to update incident' });
  }
});

// Admin: Append an internal note (never visible to the reporting worker)
router.post('/:id/notes', requireAuth, requireAdmin, async (req, res) => {
  try {
    const note = String(req.body.note || '').trim();
    if (!note) return res.status(400).json({ error: 'Note text is required' });

    const [rows] = await pool.query('SELECT * FROM incidents WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Incident not found' });

    const notes = parseJson(rows[0].internal_notes, []) || [];
    notes.push({
      note,
      author: req.user.name || req.user.email || 'Admin',
      at: new Date().toISOString(),
    });

    await pool.query('UPDATE incidents SET internal_notes = ? WHERE id = ?',
      [JSON.stringify(notes), req.params.id]);

    await logActionFromReq(req, 'added_incident_note', 'incident', req.params.id, {
      category: rows[0].category, noteCount: notes.length,
    });

    const [updated] = await pool.query('SELECT * FROM incidents WHERE id = ?', [req.params.id]);
    res.json(serialize(updated[0]));
  } catch (error) {
    console.error('Add incident note error:', error);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// Authenticated attachment viewer — admin, or the worker who filed the report.
router.get('/:id/attachment/:idx', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM incidents WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    const incident = rows[0];

    const isAdmin = req.user.role === 'admin';
    const isReporter = req.user.role === 'worker' && req.user.workerId === incident.reported_by;
    if (!isAdmin && !isReporter) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const attachments = parseJson(incident.attachments, []) || [];
    const att = attachments[Number(req.params.idx)];
    if (!att || !att.url) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    // DB-stored file (new uploads) or legacy on-disk upload
    if (isStoredFileRef(att.url)) {
      if (await sendStoredFile(res, storedFileId(att.url), { notFoundJson: false })) return;
      return res.status(404).json({ error: 'File not found on server' });
    }
    if (sendLegacyFile(res, att.url)) return;
    return res.status(404).json({ error: 'File not found on server' });
  } catch (error) {
    console.error('Incident attachment error:', error);
    res.status(500).json({ error: 'Failed to load attachment' });
  }
});

module.exports = router;
