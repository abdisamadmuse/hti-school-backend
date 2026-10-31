const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const { sequelize } = require("../config/mysql");
(async () => {
  try {
    await require("../config/db")();
    console.log("Attendance migration completed. Historical attendance remains lesson-only.");
  } catch (error) {
    console.error("Attendance migration failed:", error.message);
    process.exitCode = 1;
  } finally { await sequelize.close(); }
})();
