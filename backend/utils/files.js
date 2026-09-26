const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

// File storage backed by the `stored_files` table.
// Uploads used to live on disk under uploads/ — fine on a persistent server,
// but on Vercel the filesystem is ephemeral /tmp and files vanish between
// invocations. Storing bytes in MySQL keeps uploads working everywhere.
//
// References to a stored file use the "file:<id>" scheme anywhere a URL-style
// string was previously kept (application docUrls, incident attachments).
// The documents table uses a dedicated file_id column instead.

const generateFileId = () =>
  `FILE-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.rtf': 'application/rtf',
};

const contentTypeFor = (name) => CONTENT_TYPES[path.extname(String(name || '')).toLowerCase()] || 'application/octet-stream';

// Save a multer file (memoryStorage) — returns the new stored_files id.
const saveStoredFile = async (file) => {
  const id = generateFileId();
  await pool.query(
    'INSERT INTO stored_files (id, name, mime, size, data) VALUES (?, ?, ?, ?, ?)',
    [id, file.originalname || 'file', file.mimetype || contentTypeFor(file.originalname), file.size ?? (file.buffer ? file.buffer.length : 0), file.buffer]
  );
  return id;
};

// Fetch a stored file row. Returns { name, mime, data } or null.
const getStoredFile = async (id) => {
  const [rows] = await pool.query('SELECT name, mime, data FROM stored_files WHERE id = ?', [id]);
  return rows[0] || null;
};

const deleteStoredFile = async (id) => {
  await pool.query('DELETE FROM stored_files WHERE id = ?', [id]);
};

// Stream a stored_files row to the response (inline display).
const sendStoredFile = async (res, id, { notFoundJson = true } = {}) => {
  const row = await getStoredFile(id);
  if (!row || !row.data) {
    if (notFoundJson) res.status(404).json({ error: 'File not found' });
    return false;
  }
  res.setHeader('Content-Type', row.mime || contentTypeFor(row.name));
  res.setHeader('Content-Disposition', `inline; filename="${String(row.name || 'file').replace(/"/g, '')}"`);
  res.setHeader('Content-Length', row.data.length);
  res.send(row.data);
  return true;
};

// Resolve a legacy "/uploads/..." disk path relative to the backend folder
// (or /tmp on Vercel). Returns an absolute path or null for unknown schemes.
const legacyUploadPath = (url) => {
  const u = String(url || '');
  if (!u.startsWith('/uploads/')) return null;
  const rest = u.replace('/uploads/', '');
  return process.env.VERCEL
    ? path.join('/tmp/uploads', rest)
    : path.join(__dirname, '..', 'uploads', rest);
};

// Stream a legacy disk file if it still exists. Returns true when served.
const sendLegacyFile = (res, url) => {
  const filePath = legacyUploadPath(url);
  if (!filePath || !fs.existsSync(filePath)) return false;
  res.setHeader('Content-Type', contentTypeFor(filePath));
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
  fs.createReadStream(filePath).pipe(res);
  return true;
};

const isStoredFileRef = (v) => typeof v === 'string' && v.startsWith('file:');
// Refs look like "file:<id>/<original-name>" — the name is informational only.
const storedFileId = (v) => String(v).slice(5).split('/')[0];

/* ---- One-time migration: move referenced on-disk files into stored_files ----
   Runs at boot (ensureSchema). Any document/application/incident row still
   pointing at uploads/ on disk gets its bytes copied into stored_files and the
   reference rewritten to file:<id>. On Vercel the disk is empty so the scan
   simply finds nothing to move. */
const migrateDiskUploads = async () => {
  let moved = 0;

  const moveFile = async (diskPath, name) => {
    const buf = fs.readFileSync(diskPath);
    const id = generateFileId();
    await pool.query(
      'INSERT INTO stored_files (id, name, mime, size, data) VALUES (?, ?, ?, ?, ?)',
      [id, name || path.basename(diskPath), contentTypeFor(diskPath), buf.length, buf]
    );
    return id;
  };

  const relPath = (p) => (process.env.VERCEL ? path.join('/tmp', p) : path.join(__dirname, '..', p));

  // documents.file_path → documents.file_id
  try {
    const [docs] = await pool.query(
      "SELECT id, name, file_path FROM documents WHERE file_id IS NULL AND file_path IS NOT NULL AND file_path <> ''"
    );
    for (const d of docs) {
      const diskPath = relPath(String(d.file_path));
      if (!fs.existsSync(diskPath)) continue;
      try {
        const fid = await moveFile(diskPath, `${d.name}${path.extname(diskPath)}`);
        await pool.query('UPDATE documents SET file_id = ? WHERE id = ?', [fid, d.id]);
        moved++;
      } catch (e) {
        console.log(`⚠️ Could not migrate document file ${d.id}:`, e.message);
      }
    }
  } catch (e) {
    console.log('⚠️ Document file migration skipped:', e.message);
  }

  // signature_requests.file_path → file_id (only rows sent before file_id existed)
  try {
    const [reqs] = await pool.query(
      "SELECT id, file_path FROM signature_requests WHERE file_id IS NULL AND file_path IS NOT NULL AND file_path <> ''"
    );
    for (const r of reqs) {
      const diskPath = relPath(String(r.file_path));
      if (!fs.existsSync(diskPath)) continue;
      try {
        const fid = await moveFile(diskPath, path.basename(diskPath));
        await pool.query('UPDATE signature_requests SET file_id = ? WHERE id = ?', [fid, r.id]);
        moved++;
      } catch (e) {
        console.log(`⚠️ Could not migrate request file ${r.id}:`, e.message);
      }
    }
  } catch (e) {
    console.log('⚠️ Signature request file migration skipped:', e.message);
  }

  // registration_applications details.docUrls "/uploads/..." → "file:<id>"
  try {
    const [apps] = await pool.query("SELECT id, details FROM registration_applications WHERE details LIKE '%/uploads/%'");
    for (const a of apps) {
      let details;
      try { details = typeof a.details === 'string' ? JSON.parse(a.details) : a.details; } catch { continue; }
      const docUrls = details?.docUrls;
      if (!docUrls || typeof docUrls !== 'object') continue;
      let changed = false;
      for (const k of Object.keys(docUrls)) {
        const url = docUrls[k];
        if (typeof url !== 'string' || !url.startsWith('/uploads/')) continue;
        const diskPath = legacyUploadPath(url);
        if (!diskPath || !fs.existsSync(diskPath)) { docUrls[k] = ''; changed = true; continue; }
        try {
          docUrls[k] = `file:${await moveFile(diskPath, path.basename(diskPath))}/${encodeURIComponent(path.basename(diskPath))}`;
          changed = true;
          moved++;
        } catch (e) {
          console.log(`⚠️ Could not migrate application file ${a.id}/${k}:`, e.message);
        }
      }
      if (changed) {
        await pool.query('UPDATE registration_applications SET details = ? WHERE id = ?', [JSON.stringify(details), a.id]);
      }
    }
  } catch (e) {
    console.log('⚠️ Application file migration skipped:', e.message);
  }

  // incidents attachments "/uploads/..." → "file:<id>"
  try {
    const [rows] = await pool.query("SELECT id, attachments FROM incidents WHERE attachments LIKE '%/uploads/%'");
    for (const r of rows) {
      let atts;
      try { atts = typeof r.attachments === 'string' ? JSON.parse(r.attachments) : r.attachments; } catch { continue; }
      if (!Array.isArray(atts)) continue;
      let changed = false;
      for (const att of atts) {
        if (!att || typeof att.url !== 'string' || !att.url.startsWith('/uploads/')) continue;
        const diskPath = legacyUploadPath(att.url);
        if (!diskPath || !fs.existsSync(diskPath)) continue;
        try {
          const base = att.name || path.basename(diskPath);
          att.url = `file:${await moveFile(diskPath, base)}/${encodeURIComponent(base)}`;
          changed = true;
          moved++;
        } catch (e) {
          console.log(`⚠️ Could not migrate incident file ${r.id}:`, e.message);
        }
      }
      if (changed) {
        await pool.query('UPDATE incidents SET attachments = ? WHERE id = ?', [JSON.stringify(atts), r.id]);
      }
    }
  } catch (e) {
    console.log('⚠️ Incident file migration skipped:', e.message);
  }

  if (moved > 0) console.log(`✅ Migrated ${moved} uploaded file(s) into stored_files`);
};

module.exports = {
  saveStoredFile,
  getStoredFile,
  deleteStoredFile,
  sendStoredFile,
  sendLegacyFile,
  isStoredFileRef,
  storedFileId,
  contentTypeFor,
  migrateDiskUploads,
};
