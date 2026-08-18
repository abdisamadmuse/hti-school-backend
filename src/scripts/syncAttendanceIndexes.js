require("dotenv").config();
const { sequelize, initializeModels } = require("../config/mysql");

(async () => {
  try {
    initializeModels();
    await sequelize.sync({ alter: true });
    console.log("MySQL attendance indexes synchronized successfully");
  } catch (error) {
    console.error("Failed to synchronize MySQL indexes:", error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
