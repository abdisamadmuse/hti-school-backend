const { sequelize, initializeModels } = require("./mysql");

const addOptionalColumns = async () => {
  const queryInterface = sequelize.getQueryInterface();
  const { DataTypes } = require("sequelize");
  const tables = await queryInterface.showAllTables();
  const tableNames = new Set(
    tables.map((table) =>
      (typeof table === "string" ? table : table.tableName || table.name || "").toLowerCase()
    )
  );

  if (tableNames.has("departments")) {
    const departmentColumns = await queryInterface.describeTable("departments");
    if (!departmentColumns.defaultPassMark) {
      await queryInterface.addColumn("departments", "defaultPassMark", {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: false,
        defaultValue: 50,
      });
    }
  }

  if (tableNames.has("temporaryannualbatchs")) {
    const batchColumns = await queryInterface.describeTable("temporaryannualbatchs");
    if (!batchColumns.passMark) {
      await queryInterface.addColumn("temporaryannualbatchs", "passMark", {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: false,
        defaultValue: 50,
      });
    }
  }

  if (tableNames.has("students")) {
    const studentColumns = await queryInterface.describeTable("students");

    if (!studentColumns.classSectionId) {
      await queryInterface.addColumn("students", "classSectionId", {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
      });
    }
  }

  if (!tableNames.has("legacyresultstudents")) return;

  const legacyStudentColumns = await queryInterface.describeTable("legacyresultstudents");
  if (!legacyStudentColumns.admissionNo) {
    await queryInterface.addColumn("legacyresultstudents", "admissionNo", {
      type: DataTypes.STRING,
      allowNull: true,
    });
  }
  if (!legacyStudentColumns.legacyStudentKey) {
    await queryInterface.addColumn("legacyresultstudents", "legacyStudentKey", {
      type: DataTypes.STRING,
      allowNull: true,
    });
  }
  if (legacyStudentColumns.studentId && legacyStudentColumns.studentId.allowNull === false) {
    await queryInterface.changeColumn("legacyresultstudents", "studentId", {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    });
  }
};

module.exports = async function connectDB() {
  try {
    initializeModels();
    await sequelize.authenticate();
    // Upgrade existing tables before sync creates indexes that use new columns.
    // On a fresh database this is a no-op; sync creates the complete schema.
    await addOptionalColumns();
    await sequelize.sync();
    await addOptionalColumns();
    console.log("MySQL Connected Successfully");
  } catch (error) {
    console.error("MySQL Connection Failed:", error.message);
    process.exit(1);
  }
};
