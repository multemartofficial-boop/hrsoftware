const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');

const generateId = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

// Multer for PDF uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // /tmp on Vercel (ephemeral); local uploads/ dir otherwise
    const dir = process.env.VERCEL ? '/tmp/uploads/documents' : 'uploads/documents';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `doc-${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`);
  },
});
const upload = multer({
  storage,
  limits: {
    fileSize: 3 * 1024 * 1024,
    fieldSize: 10 * 1024 * 1024,
    files: 20,
    fields: 100,
  },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.pdf' || file.mimetype === 'application/pdf') {
      return cb(null, true);
    }
    cb(new Error('Only PDF files are allowed'));
  },
});

// Substitute {{tokens}} with the worker's real record data
const renderTemplate = (content, worker, locationsByName) => {
  const loc = worker.location && locationsByName[worker.location];
  return content
    .replace(/\{\{\s*worker_name\s*\}\}/gi, worker.name || '')
    .replace(/\{\{\s*worker_code\s*\}\}/gi, worker.id || '')
    .replace(/\{\{\s*start_date\s*\}\}/gi, worker.joined ? String(worker.joined).slice(0, 10) : '')
    .replace(/\{\{\s*hourly_rate\s*\}\}/gi, worker.rate != null ? `£${Number(worker.rate).toFixed(2)}` : '')
    .replace(/\{\{\s*location_name\s*\}\}/gi, loc?.name || worker.location || '');
};

/* ================= ADMIN: documents ================= */

// List documents
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM documents ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) {
    console.error('List documents error:', e);
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

// Upload a PDF document
router.post('/upload', requireAuth, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'PDF file is required' });
    const name = req.body.name || req.file.originalname.replace(/\.pdf$/i, '');
    const id = generateId('DOC');
    await pool.query(
      'INSERT INTO documents (id, name, type, file_path, uploaded_by_admin_id) VALUES (?, ?, ?, ?, ?)',
      [id, name, 'uploaded_pdf', req.file.path, req.user.userId || null]
    );
    res.status(201).json({ id, name, type: 'uploaded_pdf', filePath: req.file.path });
  } catch (e) {
    console.error('Upload document error:', e);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// Create a text template with {{placeholder}} tokens
router.post('/template', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, content } = req.body;
    if (!name || !content) return res.status(400).json({ error: 'name and content are required' });
    const id = generateId('DOC');
    await pool.query(
      'INSERT INTO documents (id, name, type, content, uploaded_by_admin_id) VALUES (?, ?, ?, ?, ?)',
      [id, name, 'template', content, req.user.userId || null]
    );
    res.status(201).json({ id, name, type: 'template' });
  } catch (e) {
    console.error('Create template error:', e);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// Edit a document: rename always; content only for templates; optional file replace for PDFs
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, content } = req.body;
    const [docs] = await pool.query('SELECT * FROM documents WHERE id = ?', [req.params.id]);
    if (docs.length === 0) return res.status(404).json({ error: 'Document not found' });
    const doc = docs[0];

    const sets = ['name = ?'];
    const params = [name ?? doc.name];
    if (doc.type === 'template' && content !== undefined) {
      sets.push('content = ?');
      params.push(content);
    }
    params.push(req.params.id);
    await pool.query(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`, params);
    res.json({ message: 'Document updated' });
  } catch (e) {
    console.error('Update document error:', e);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

// Replace the underlying PDF file (deletes the old file)
router.put('/:id/file', requireAuth, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const [docs] = await pool.query('SELECT * FROM documents WHERE id = ?', [req.params.id]);
    if (docs.length === 0) return res.status(404).json({ error: 'Document not found' });
    if (docs[0].type !== 'uploaded_pdf') return res.status(400).json({ error: 'Only PDF uploads have files' });
    if (!req.file) return res.status(400).json({ error: 'PDF file is required' });

    if (docs[0].file_path && fs.existsSync(docs[0].file_path)) fs.unlinkSync(docs[0].file_path);
    await pool.query('UPDATE documents SET file_path = ? WHERE id = ?', [req.file.path, req.params.id]);
    res.json({ message: 'File replaced' });
  } catch (e) {
    console.error('Replace file error:', e);
    res.status(500).json({ error: 'Failed to replace file' });
  }
});

// Delete a document — blocked if any signature_requests are linked (audit integrity)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [docs] = await pool.query('SELECT * FROM documents WHERE id = ?', [req.params.id]);
    if (docs.length === 0) return res.status(404).json({ error: 'Document not found' });
    const doc = docs[0];

    const [[{ n }]] = await pool.query(
      'SELECT COUNT(*) AS n FROM signature_requests WHERE document_id = ?',
      [req.params.id]
    );
    if (n > 0) {
      return res.status(409).json({
        error: `Cannot delete — this document has ${n} signature request(s) linked to it. Cancel or resolve them first.`
      });
    }

    if (doc.file_path && fs.existsSync(doc.file_path)) fs.unlinkSync(doc.file_path);
    await pool.query('DELETE FROM documents WHERE id = ?', [req.params.id]);
    res.json({ message: 'Document deleted' });
  } catch (e) {
    console.error('Delete document error:', e);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// Preview a template rendered for a specific worker
router.get('/:id/preview/:workerId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [docs] = await pool.query('SELECT * FROM documents WHERE id = ?', [req.params.id]);
    if (docs.length === 0) return res.status(404).json({ error: 'Document not found' });
    const doc = docs[0];
    const [workers] = await pool.query('SELECT * FROM workers WHERE id = ?', [req.params.workerId]);
    if (workers.length === 0) return res.status(404).json({ error: 'Worker not found' });
    const [locs] = await pool.query('SELECT id, name FROM locations');
    const locationsByName = Object.fromEntries(locs.map(l => [l.name, l]));
    res.json({ rendered: doc.type === 'template' ? renderTemplate(doc.content || '', workers[0], locationsByName) : null });
  } catch (e) {
    console.error('Preview error:', e);
    res.status(500).json({ error: 'Failed to render preview' });
  }
});

// Send a document/template to a worker for signature
router.post('/:id/send', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { workerId } = req.body;
    if (!workerId) return res.status(400).json({ error: 'workerId is required' });

    const [docs] = await pool.query('SELECT * FROM documents WHERE id = ?', [req.params.id]);
    if (docs.length === 0) return res.status(404).json({ error: 'Document not found' });
    const doc = docs[0];

    const [workers] = await pool.query('SELECT * FROM workers WHERE id = ?', [workerId]);
    if (workers.length === 0) return res.status(404).json({ error: 'Worker not found' });
    const worker = workers[0];

    const [locs] = await pool.query('SELECT id, name FROM locations');
    const locationsByName = Object.fromEntries(locs.map(l => [l.name, l]));

    const reqId = generateId('SIG');
    const rendered = doc.type === 'template' ? renderTemplate(doc.content || '', worker, locationsByName) : null;
    await pool.query(
      `INSERT INTO signature_requests
       (id, document_id, worker_id, status, rendered_content, file_path, created_by_admin_id)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
      [reqId, doc.id, workerId, rendered, doc.file_path, req.user.userId || null]
    );

    // Notify the worker by email
    await sendEmail({
      to: worker.email,
      subject: `Document to sign: ${doc.name}`,
      html: `<h2>Document awaiting your signature</h2>
        <p>Hi ${worker.name},</p>
        <p><strong>${doc.name}</strong> has been sent to you for signing. Log in to your Worker Dashboard to review and sign it.</p>`,
      text: `${doc.name} has been sent to you for signing. Log in to your Worker Dashboard to review and sign it.`,
    });

    res.status(201).json({ id: reqId, status: 'pending', message: 'Signature request sent' });
  } catch (e) {
    console.error('Send signature request error:', e);
    res.status(500).json({ error: 'Failed to send signature request' });
  }
});

/* ================= WORKER: sign / decline ================= */

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;

const logAudit = async (reqId, event, ip) => {
  try {
    await pool.query(
      `UPDATE signature_requests
       SET audit_log = JSON_ARRAY_APPEND(COALESCE(audit_log, JSON_ARRAY()), '$',
            JSON_OBJECT('event', ?, 'at', NOW(), 'ip', ?))
       WHERE id = ?`,
      [event, ip, reqId]
    );
  } catch (e) {
    console.error('Audit log error:', e);
  }
};

const loadRequestForWorker = async (reqId, workerId) => {
  const [rows] = await pool.query(
    `SELECT r.*, d.name AS document_name, d.type AS document_type
     FROM signature_requests r JOIN documents d ON d.id = r.document_id
     WHERE r.id = ? AND r.worker_id = ?`,
    [reqId, workerId]
  );
  return rows[0] || null;
};

// Worker's own requests (identity from token only)
router.get('/requests/mine', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'worker') return res.status(403).json({ error: 'Workers only' });
    const [rows] = await pool.query(
      `SELECT r.id, r.document_id, d.name AS document_name, d.type AS document_type,
              r.status, r.sent_at, r.viewed_at, r.signed_at, r.declined_at
       FROM signature_requests r
       JOIN documents d ON d.id = r.document_id
       WHERE r.worker_id = ?
       ORDER BY r.sent_at DESC`,
      [req.user.workerId]
    );
    res.json(rows);
  } catch (e) {
    console.error('My requests error:', e);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

// Mark a request as viewed (called when the worker opens the review page)
router.post('/requests/:id/view', requireAuth, async (req, res) => {
  try {
    const r = await loadRequestForWorker(req.params.id, req.user.workerId);
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (r.status === 'pending' && !r.viewed_at) {
      await pool.query('UPDATE signature_requests SET viewed_at = NOW() WHERE id = ?', [req.params.id]);
    }
    await logAudit(req.params.id, 'viewed', clientIp(req));
    res.json({ viewed: true });
  } catch (e) {
    console.error('View mark error:', e);
    res.status(500).json({ error: 'Failed to record view' });
  }
});

// Sign a request
router.post('/requests/:id/sign', requireAuth, async (req, res) => {
  try {
    const r = await loadRequestForWorker(req.params.id, req.user.workerId);
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (r.status !== 'pending') return res.status(400).json({ error: `Request is already ${r.status}` });

    const { signatureType, signatureData } = req.body;
    if (!['draw', 'type', 'upload'].includes(signatureType) || !signatureData) {
      return res.status(400).json({ error: 'signatureType (draw|type|upload) and signatureData are required' });
    }

    const ip = clientIp(req);

    // Build the final signed content: rendered content + signature block.
    // For PDFs the signature is stored alongside (signature_data + type) —
    // no PDF overlay, keeping the original file untouched.
    const signedBlock =
      `\n\n---\nSigned by ${r.worker_id} on ${new Date().toISOString()}` +
      (signatureType === 'type'
        ? `\nSignature (typed): ${signatureData}`
        : `\nSignature: [captured ${signatureType} image — stored in signature_data]`) +
      (ip ? `\nSigner IP: ${ip}` : '');
    const signedContent = (r.rendered_content || `[PDF document: ${r.document_name}]`) + signedBlock;

    await pool.query(
      `UPDATE signature_requests
       SET status='signed', signed_at=NOW(), signature_type=?, signature_data=?, signer_ip=?, signed_content=?
       WHERE id = ?`,
      [signatureType, signatureData, ip, signedContent, req.params.id]
    );
    await logAudit(req.params.id, 'signed', ip);

    // Notify admin
    const [w] = await pool.query('SELECT name FROM workers WHERE id = ?', [r.worker_id]);
    await pool.query(
      'INSERT INTO notifications (id, worker, worker_id, message, urgency) VALUES (?, ?, ?, ?, ?)',
      [`SGN-${req.params.id}`, w[0]?.name || r.worker_id, r.worker_id,
       `[Signature] ${w[0]?.name || r.worker_id} signed "${r.document_name}" on ${new Date().toISOString().slice(0, 10)}.`,
       'info']
    );

    res.json({ status: 'signed', signedAt: new Date().toISOString() });
  } catch (e) {
    console.error('Sign error:', e);
    res.status(500).json({ error: 'Failed to sign' });
  }
});

// Decline a request
router.post('/requests/:id/decline', requireAuth, async (req, res) => {
  try {
    const r = await loadRequestForWorker(req.params.id, req.user.workerId);
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (r.status !== 'pending') return res.status(400).json({ error: `Request is already ${r.status}` });

    const ip = clientIp(req);
    await pool.query("UPDATE signature_requests SET status='declined', declined_at=NOW(), signer_ip=? WHERE id = ?", [ip, req.params.id]);
    await logAudit(req.params.id, 'declined', ip);

    const [w] = await pool.query('SELECT name FROM workers WHERE id = ?', [r.worker_id]);
    await pool.query(
      'INSERT INTO notifications (id, worker, worker_id, message, urgency) VALUES (?, ?, ?, ?, ?)',
      [`SGN-${req.params.id}`, w[0]?.name || r.worker_id, r.worker_id,
       `[Signature] ${w[0]?.name || r.worker_id} declined to sign "${r.document_name}" on ${new Date().toISOString().slice(0, 10)}.`,
       'warning']
    );

    res.json({ status: 'declined' });
  } catch (e) {
    console.error('Decline error:', e);
    res.status(500).json({ error: 'Failed to decline' });
  }
});

/* ================= ADMIN: tracking ================= */

// List all signature requests
router.get('/requests', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.document_id, d.name AS document_name, d.type AS document_type,
              r.worker_id, w.name AS worker_name, r.status, r.file_path,
              r.sent_at, r.signed_at, r.declined_at
       FROM signature_requests r
       JOIN documents d ON d.id = r.document_id
       JOIN workers w ON w.id = r.worker_id
       ORDER BY r.sent_at DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error('List requests error:', e);
    res.status(500).json({ error: 'Failed to load signature requests' });
  }
});

// View a single request (rendered content or file path)
router.get('/requests/:id', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*, d.name AS document_name, d.type AS document_type, w.name AS worker_name
       FROM signature_requests r
       JOIN documents d ON d.id = r.document_id
       JOIN workers w ON w.id = r.worker_id
       WHERE r.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const r = rows[0];
    // Workers may only view their own requests
    if (req.user.role === 'worker' && r.worker_id !== req.user.workerId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(r);
  } catch (e) {
    console.error('Get request error:', e);
    res.status(500).json({ error: 'Failed to load request' });
  }
});

// Cancel a pending request
router.post('/requests/:id/cancel', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT status FROM signature_requests WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    if (rows[0].status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be cancelled' });
    await pool.query("UPDATE signature_requests SET status = 'cancelled' WHERE id = ?", [req.params.id]);
    res.json({ message: 'Request cancelled' });
  } catch (e) {
    console.error('Cancel request error:', e);
    res.status(500).json({ error: 'Failed to cancel request' });
  }
});

module.exports = router;
