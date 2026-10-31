const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const { sequelize } = require("../config/mysql");
const migrate = require("../config/assessmentMigration");
(async () => {
  try { await sequelize.authenticate(); await migrate(sequelize); console.log("Assessment columns ready; no historical allocations changed"); }
  catch (error) { console.error("Assessment migration failed:", error.name); process.exitCode = 1; }
  finally { await sequelize.close(); }
})();
