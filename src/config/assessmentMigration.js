// Additive and repeatable. MySQL DDL implicitly commits; never use sync({ alter/force }).
module.exports = async function migrateAssessment(sequelize) {
  const { DataTypes } = require("sequelize");
  const qi = sequelize.getQueryInterface();
  const tables = new Set((await qi.showAllTables()).map((t) => typeof t === "string" ? t : t.tableName || t.name));
  const mark = () => ({ type: DataTypes.DECIMAL(8, 2), allowNull: true });
  const monthly = () => ({ type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  const additions = {
    subjects: { theoryMaxMarks: mark(), practicalMaxMarks: mark(), passMark: mark(), hasMonthlyAssessment: monthly(), monthlyAssessmentMaxMarks: mark() },
    examsubjects: { hasMonthlyAssessment: monthly(), monthlyAssessmentMaxMarks: { ...mark(), defaultValue: 0 } },
    studentmarks: { monthlyAssessmentMark: mark() },
    markedithistorys: { oldMonthlyAssessmentMark: mark(), newMonthlyAssessmentMark: mark() },
  };
  for (const [table, columns] of Object.entries(additions)) {
    if (!tables.has(table)) continue;
    const existing = await qi.describeTable(table);
    for (const [column, definition] of Object.entries(columns)) {
      if (!existing[column]) await qi.addColumn(table, column, definition);
    }
  }
};
