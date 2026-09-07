require("dotenv").config();
const pool = require("./config/database");
(async () => {
  const [rows] = await pool.query("SELECT id, name, email, status, submitted, JSON_EXTRACT(details, \"$.lastStep\") ls FROM registration_applications WHERE status=? ORDER BY submitted DESC", ["draft"]);
  console.log("draft rows:", JSON.stringify(rows, null, 1));
  process.exit(0);
})();
