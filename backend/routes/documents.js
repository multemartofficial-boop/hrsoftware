const express = require('express');
const router = express.Router();
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');
const { stripSignaturePlaceholders, getCompanySignatory } = require('../utils/document-text');

const generateId = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

// Fingerprint of a template's content — the stored company signature is only
// valid while the content still hashes to signed_content_hash.
const contentHash = (c) => crypto.createHash('sha256').update(String(c ?? '')).digest('hex');

// Part 7: signature requests are template-based only — no arbitrary PDF
// uploads. Legacy uploaded_pdf rows/files stay for already-sent requests.

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

// File uploads (job descriptions, RAMS, etc.) sent to workers for signature.
// Stored under uploads/documents/ and served via /uploads static.
const docStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = process.env.VERCEL ? '/tmp/uploads/documents' : path.join(__dirname, '..', 'uploads', 'documents');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `doc-${Date.now()}-${Math.floor(Math.random() * 1000)}${ext}`);
  },
});
const ALLOWED_DOC_EXT = new Set(['.docx', '.doc', '.pdf', '.txt', '.rtf']);
const docUpload = multer({
  storage: docStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_DOC_EXT.has(ext)) {
      return cb(new Error('Only .docx, .doc, .pdf, .txt or .rtf files are allowed'));
    }
    cb(null, true);
  },
});

// Admin: upload a document file (job description, RAMS, policy…) that can then
// be sent to a worker for signature — no template content needed.
router.post('/upload', requireAuth, requireAdmin, docUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'A file is required' });
    const name = (req.body.name && String(req.body.name).trim())
      || req.file.originalname.replace(/\.[^.]+$/, '');
    const id = generateId('DOC');
    const filePath = path.posix.join('uploads', 'documents', req.file.filename);
    await pool.query(
      "INSERT INTO documents (id, name, type, content, file_path, uploaded_by_admin_id) VALUES (?, ?, 'uploaded', NULL, ?, ?)",
      [id, name, filePath, req.user.userId || null]
    );
    res.status(201).json({ id, name, type: 'uploaded', file_path: filePath });
  } catch (e) {
    console.error('Document upload error:', e);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

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
      // Content changed after signing → the company must re-sign before the
      // template can be sent again.
      if (doc.admin_signed_at && contentHash(content) !== doc.signed_content_hash) {
        sets.push('admin_signature_type = NULL, admin_signature_data = NULL, admin_signed_by = NULL, admin_signed_at = NULL, admin_signer_ip = NULL, signed_content_hash = NULL');
      }
    }
    params.push(req.params.id);
    await pool.query(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`, params);
    res.json({ message: 'Document updated' });
  } catch (e) {
    console.error('Update document error:', e);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

// Company signature on the TEMPLATE itself — required before the template can
// be sent to any worker, and reused for every send until the content changes.
router.post('/:id/sign-template', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [docs] = await pool.query('SELECT * FROM documents WHERE id = ?', [req.params.id]);
    if (docs.length === 0) return res.status(404).json({ error: 'Document not found' });
    const doc = docs[0];
    if (doc.type !== 'template') {
      return res.status(400).json({ error: 'Only templates can be signed' });
    }

    const { signatureType, signatureData } = req.body;
    if (!['draw', 'type', 'upload'].includes(signatureType) || !signatureData) {
      return res.status(400).json({ error: 'signatureType (draw|type|upload) and signatureData are required' });
    }

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;
    // The name shown under "Signed by Company" is the authorised signatory
    // from Settings (company_signatory), not the logged-in admin.
    const adminName = await getCompanySignatory(req.user.name || `Admin #${req.user.userId}`);

    await pool.query(
      `UPDATE documents
       SET admin_signature_type=?, admin_signature_data=?, admin_signed_by=?,
           admin_signed_at=NOW(), admin_signer_ip=?, signed_content_hash=?
       WHERE id = ?`,
      [signatureType, signatureData, adminName, ip, contentHash(doc.content), req.params.id]
    );

    res.json({ message: 'Template signed — it can now be sent for signature', adminSignedBy: adminName });
  } catch (e) {
    console.error('Sign template error:', e);
    res.status(500).json({ error: 'Failed to sign template' });
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
    res.json({ rendered: doc.type === 'template' ? stripSignaturePlaceholders(renderTemplate(doc.content || '', workers[0], locationsByName)) : null });
  } catch (e) {
    console.error('Preview error:', e);
    res.status(500).json({ error: 'Failed to render preview' });
  }
});

// Send a template to a worker for signature (template-based only — Part 7)
router.post('/:id/send', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { workerId } = req.body;
    if (!workerId) return res.status(400).json({ error: 'workerId is required' });

    const [docs] = await pool.query('SELECT * FROM documents WHERE id = ?', [req.params.id]);
    if (docs.length === 0) return res.status(404).json({ error: 'Document not found' });
    const doc = docs[0];
    const isUpload = doc.type === 'uploaded';
    if (doc.type !== 'template' && !isUpload) {
      return res.status(400).json({ error: 'Only templates or uploaded documents can be sent for signature' });
    }
    // The company must have signed the template itself, and that signature is
    // only valid while the content is unchanged. Uploaded documents skip this —
    // the worker signs first, then the company countersigns the request.
    if (!isUpload && (!doc.admin_signed_at || doc.signed_content_hash !== contentHash(doc.content))) {
      return res.status(400).json({
        error: 'This template must be signed by an admin before it can be sent — add the company signature to the template first.'
      });
    }

    const [workers] = await pool.query('SELECT * FROM workers WHERE id = ?', [workerId]);
    if (workers.length === 0) return res.status(404).json({ error: 'Worker not found' });
    const worker = workers[0];

    const [locs] = await pool.query('SELECT id, name FROM locations');
    const locationsByName = Object.fromEntries(locs.map(l => [l.name, l]));

    const reqId = generateId('SIG');
    const rendered = isUpload
      ? null
      : stripSignaturePlaceholders(renderTemplate(doc.content || '', worker, locationsByName));
    // Snapshot the template's company signature onto the request so the final
    // document carries both signatures.
    await pool.query(
      `INSERT INTO signature_requests
       (id, document_id, worker_id, status, rendered_content, file_path, created_by_admin_id,
        admin_signature_type, admin_signature_data, admin_signed_by, admin_signed_at, admin_signer_ip)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [reqId, doc.id, workerId, rendered, doc.file_path, req.user.userId || null,
       doc.admin_signature_type, doc.admin_signature_data, doc.admin_signed_by, doc.admin_signed_at, doc.admin_signer_ip]
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

// Sign a request (worker). Requests sent from a company-signed template carry
// the admin signature already, so the worker's signature completes the
// document ('signed'). Legacy requests without a company signature still move
// to 'worker_signed' and await the admin countersignature.
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
    const [w] = await pool.query('SELECT name FROM workers WHERE id = ?', [r.worker_id]);
    const workerName = w[0]?.name || r.worker_id;
    const companySigned = !!r.admin_signed_at;

    // Company block first (it was signed at template creation), then the worker's.
    let signedContent = r.rendered_content || `[Document: ${r.document_name}]`;
    if (companySigned) {
      signedContent +=
        `\n\n---\nSigned by the Director of SSSL: ${r.admin_signed_by || 'Company'} on ${new Date(r.admin_signed_at).toISOString()}` +
        (r.admin_signature_type === 'type'
          ? `\nSignature (typed): ${r.admin_signature_data}`
          : `\nSignature: [captured ${r.admin_signature_type} image — stored in admin_signature_data]`);
    }
    signedContent +=
      `\n\nSigned by Worker: ${workerName} on ${new Date().toISOString()}` +
      (signatureType === 'type'
        ? `\nSignature (typed): ${signatureData}`
        : `\nSignature: [captured ${signatureType} image — stored in signature_data]`) +
      (ip ? `\nSigner IP: ${ip}` : '');

    const newStatus = companySigned ? 'signed' : 'worker_signed';
    await pool.query(
      `UPDATE signature_requests
       SET status=?, signed_at=NOW(), signature_type=?, signature_data=?, signer_ip=?, signed_content=?
       WHERE id = ?`,
      [newStatus, signatureType, signatureData, ip, signedContent, req.params.id]
    );
    await logAudit(req.params.id, 'worker_signed', ip);

    await pool.query(
      'INSERT INTO notifications (id, worker, worker_id, message, urgency) VALUES (?, ?, ?, ?, ?)',
      [`SGN-${req.params.id}`, workerName, r.worker_id,
       companySigned
         ? `[Signature] ${workerName} signed "${r.document_name}" — document complete (company signature already on file).`
         : `[Signature] ${workerName} signed "${r.document_name}" — awaiting company countersignature.`,
       'info']
    );

    res.json({ status: newStatus, signedAt: new Date().toISOString() });
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

/* ================= ADMIN: countersignature + tracking ================= */

// Company countersignature — the second signature that completes a request.
// Allowed on 'worker_signed' requests and on legacy 'signed' requests that
// were completed before dual signatures existed (admin_signed_at IS NULL).
router.post('/requests/:id/countersign', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*, d.name AS document_name, w.name AS worker_name
       FROM signature_requests r
       JOIN documents d ON d.id = r.document_id
       JOIN workers w ON w.id = r.worker_id
       WHERE r.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const r = rows[0];

    if (!['worker_signed', 'signed'].includes(r.status)) {
      return res.status(400).json({ error: `Cannot countersign a ${r.status} request` });
    }
    if (r.admin_signed_at) {
      return res.status(400).json({ error: 'This request has already been countersigned' });
    }

    const { signatureType, signatureData } = req.body;
    if (!['draw', 'type', 'upload'].includes(signatureType) || !signatureData) {
      return res.status(400).json({ error: 'signatureType (draw|type|upload) and signatureData are required' });
    }

    const ip = clientIp(req);
    const adminName = await getCompanySignatory(req.user.name || `Admin #${req.user.userId}`);

    const counterBlock =
      `\n\nSigned by the Director of SSSL: ${adminName} on ${new Date().toISOString()}` +
      (signatureType === 'type'
        ? `\nSignature (typed): ${signatureData}`
        : `\nSignature: [captured ${signatureType} image — stored in admin_signature_data]`) +
      (ip ? `\nSigner IP: ${ip}` : '');
    const signedContent = (r.signed_content || r.rendered_content || `[Document: ${r.document_name}]`) + counterBlock;

    await pool.query(
      `UPDATE signature_requests
       SET status='signed', admin_signature_type=?, admin_signature_data=?, admin_signed_by=?,
           admin_signed_at=NOW(), admin_signer_ip=?, signed_content=?
       WHERE id = ?`,
      [signatureType, signatureData, adminName, ip, signedContent, req.params.id]
    );
    await logAudit(req.params.id, 'admin_signed', ip);

    res.json({ status: 'signed', adminSignedAt: new Date().toISOString(), adminSignedBy: adminName });
  } catch (e) {
    console.error('Countersign error:', e);
    res.status(500).json({ error: 'Failed to countersign' });
  }
});

// List all signature requests
router.get('/requests', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.document_id, d.name AS document_name, d.type AS document_type,
              r.worker_id, w.name AS worker_name, r.status, r.file_path,
              r.sent_at, r.signed_at, r.declined_at, r.admin_signed_at, r.admin_signed_by
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

// Cancel a request that isn't fully signed yet
router.post('/requests/:id/cancel', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT status FROM signature_requests WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    if (!['pending', 'worker_signed'].includes(rows[0].status)) {
      return res.status(400).json({ error: 'Only requests awaiting signatures can be cancelled' });
    }
    await pool.query("UPDATE signature_requests SET status = 'cancelled' WHERE id = ?", [req.params.id]);
    res.json({ message: 'Request cancelled' });
  } catch (e) {
    console.error('Cancel request error:', e);
    res.status(500).json({ error: 'Failed to cancel request' });
  }
});

module.exports = router;
