require("dotenv").config();
const pool = require("./config/database");
(async () => {
  const [rows] = await pool.query("SELECT id, name, email, status, submitted FROM registration_applications ORDER BY submitted DESC LIMIT 6");
  console.log(JSON.stringify(rows, null, 1));
  process.exit(0);
})();
