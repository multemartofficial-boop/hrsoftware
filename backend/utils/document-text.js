const pool = require('../config/database');

// Remove blank handwritten sign-off lines from document text, e.g.
//   Signed ______________________   Date ____________
//       for SINHA SECURITY SERVICES LIMITED
// Real signature blocks are appended by the system ("Signed by Company" /
// "Signed by Worker"), so placeholder lines pasted into a template body would
// otherwise appear as stray blank lines in the final document.
const SIGNED_LINE = /^\s*signed\s*[_–—\-.]{3,}/i;
const FOR_LINE = /^\s*for\s+\S/i;

const stripSignaturePlaceholders = (text) => {
  const lines = String(text ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (SIGNED_LINE.test(lines[i])) {
      // Also drop an indented "for <Company>" designation line that follows
      if (FOR_LINE.test(lines[i + 1] || '')) i++;
      continue;
    }
    out.push(lines[i]);
  }
  // Collapse the run of blank lines a stripped block leaves behind
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
};

// The name shown under "Signed by Company" — the authorised signatory from
// Settings, falling back to the logged-in admin's name.
const getCompanySignatory = async (fallback) => {
  try {
    const [rows] = await pool.query('SELECT company_signatory FROM settings WHERE id = 1');
    const v = rows[0]?.company_signatory;
    if (v && String(v).trim()) return String(v).trim();
  } catch { /* column may not exist yet on first boot */ }
  return fallback;
};

module.exports = { stripSignaturePlaceholders, getCompanySignatory };
