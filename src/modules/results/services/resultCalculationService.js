const { calculateMark } = require("../../examMarks/services/assessment");
const { Op } = require("sequelize");
const { sequelize, initializeModels } = require("../../../config/mysql");
const { assertDepartmentAccess } = require("../../examMarks/services/manualMarkService");

const plain = (record) => (record ? record.get({ plain: true }) : null);
const gradeFor = (percentage, scales) =>
  scales.find(
    (scale) =>
      percentage >= Number(scale.minimumPercentage) &&
      percentage <= Number(scale.maximumPercentage)
  );

const loadCalculationContext = async ({ examId, classId }, user) => {
  if (!examId || !classId) {
    const error = new Error("examId and classId are required");
    error.status = 400;
    throw error;
  }
  const models = initializeModels();
  const [exam, selectedClass, examSubjects] = await Promise.all([
    models.Exam.findByPk(examId),
    models.Class.findByPk(classId),
    models.ExamSubject.findAll({
      where: { examId, classId, isActive: true },
      order: [["subjectId", "ASC"]],
    }),
  ]);
  if (!exam) {
    const error = new Error("Exam not found");
    error.status = 404;
    throw error;
  }
  if (!selectedClass) {
    const error = new Error("Class not found");
    error.status = 404;
    throw error;
  }
  assertDepartmentAccess(user, selectedClass.departmentId);
  if (Number(selectedClass.academicYearId) !== Number(exam.academicYearId)) {
    const error = new Error("Class does not belong to the exam academic year");
    error.status = 400;
    throw error;
  }
  if (exam.status !== "Open") {
    const error = new Error("Results can only be calculated for an Open exam; unpublish before corrections");
    error.status = 409;
    throw error;
  }
  if (!examSubjects.length) {
    const error = new Error("No subjects are configured for this exam and class");
    error.status = 409;
    throw error;
  }

  const [students, marks, gradingScales] = await Promise.all([
    models.Student.findAll({
      where: {
        classId,
        academicYearId: exam.academicYearId,
        status: "Active",
        isActive: true,
      },
      order: [["fullName", "ASC"]],
    }),
    models.StudentMark.findAll({ where: { examId, classId } }),
    models.GradingScale.findAll({
      where: { programId: selectedClass.programId, isActive: true },
      order: [["minimumPercentage", "DESC"]],
    }),
  ]);
  if (!students.length) {
    const error = new Error("No active students found for this class");
    error.status = 409;
    throw error;
  }
  if (!gradingScales.length) {
    const error = new Error("No active grading scale is configured for this class program");
    error.status = 409;
    throw error;
  }
  return {
    models,
    exam: plain(exam),
    selectedClass: plain(selectedClass),
    examSubjects: examSubjects.map(plain),
    students: students.map(plain),
    marks: marks.map(plain),
    gradingScales: gradingScales.map(plain),
  };
};

const calculateStudents = (context) => {
  const marks = new Map(
    context.marks.map((mark) => [`${mark.studentId}:${mark.subjectId}`, mark])
  );
  const markUpdates = [];
  const summaries = context.students.map((student) => {
    let totalMarksObtained = 0;
    let totalMaximumMarks = 0;
    let subjectsTaken = 0;
    let subjectsPassed = 0;
    let subjectsFailed = 0;
    let subjectsExempted = 0;
    let subjectsMissing = 0;

    context.examSubjects.forEach((configuration) => {
      const mark = marks.get(`${student.id}:${configuration.subjectId}`);
      if (!mark || mark.resultStatus === "Missing") {
        subjectsMissing += 1;
        totalMaximumMarks += Number(configuration.totalMaxMarks);
        return;
      }
      if (mark.resultStatus === "Exempted") {
        subjectsExempted += 1;
        return;
      }
      subjectsTaken += 1;
      totalMaximumMarks += Number(configuration.totalMaxMarks);
      if (mark.resultStatus === "Absent") {
        subjectsFailed += 1;
        markUpdates.push({ id: mark.id, grade: null });
        return;
      }
      const verified = calculateMark({ ...mark, markStatus: "Present" }, configuration);
      if (verified.errors.length) {
        subjectsMissing += 1;
        subjectsTaken -= 1;
        return;
      }
      const total = verified.values.totalMark;
      const percentage = Number(
        ((total / Number(configuration.totalMaxMarks)) * 100).toFixed(2)
      );
      const scale = gradeFor(percentage, context.gradingScales);
      if (!scale) {
        const error = new Error(`No grade range covers ${percentage}% for student ${student.admissionNo}`);
        error.status = 409;
        throw error;
      }
      totalMarksObtained += total;
      const subjectPassed = total >= Number(configuration.passMark);
      if (subjectPassed) subjectsPassed += 1;
      else subjectsFailed += 1;
      markUpdates.push({
        id: mark.id,
        grade: scale.grade,
        percentage,
        resultStatus: subjectPassed ? "Pass" : "Fail",
      });
    });

    const complete = subjectsMissing === 0;
    const averagePercentage =
      complete && totalMaximumMarks > 0
        ? Number(((totalMarksObtained / totalMaximumMarks) * 100).toFixed(2))
        : null;
    const overallGrade =
      averagePercentage === null
        ? null
        : gradeFor(averagePercentage, context.gradingScales);
    if (averagePercentage !== null && !overallGrade) {
      const error = new Error(`No grade range covers overall average ${averagePercentage}%`);
      error.status = 409;
      throw error;
    }
    const overallStatus = !complete
      ? "Incomplete"
      : subjectsFailed > 0 || !overallGrade?.isPass
      ? "Fail"
      : "Pass";
    return {
      examId: context.exam.id,
      studentId: student.id,
      academicYearId: context.exam.academicYearId,
      termId: context.exam.termId,
      classId: context.selectedClass.id,
      totalMarksObtained,
      totalMaximumMarks,
      averagePercentage,
      grade: overallGrade?.grade || null,
      subjectsTaken,
      subjectsPassed,
      subjectsFailed,
      subjectsExempted,
      subjectsMissing,
      classPosition: null,
      overallStatus,
      calculatedAt: new Date(),
      student,
    };
  });

  const ranked = summaries
    .filter((summary) => summary.averagePercentage !== null)
    .sort((left, right) => right.averagePercentage - left.averagePercentage);
  let previousAverage = null;
  let previousPosition = 0;
  ranked.forEach((summary, index) => {
    if (summary.averagePercentage !== previousAverage) {
      previousPosition = index + 1;
      previousAverage = summary.averagePercentage;
    }
    summary.classPosition = previousPosition;
  });
  return { summaries, markUpdates };
};

const persistResults = async (context, calculation) => {
  await sequelize.transaction(async (transaction) => {
    for (const update of calculation.markUpdates) {
      await context.models.StudentMark.update(
        {
          grade: update.grade,
          ...(update.percentage !== undefined && { percentage: update.percentage }),
          ...(update.resultStatus && { resultStatus: update.resultStatus }),
        },
        { where: { id: update.id }, transaction }
      );
    }
    const calculatedAt = new Date();
    for (const summary of calculation.summaries) {
      const values = { ...summary, calculatedAt };
      delete values.student;
      await context.models.ResultSummary.upsert(values, { transaction });
    }
    await context.models.ResultSummary.destroy({
      where: {
        examId: context.exam.id,
        classId: context.selectedClass.id,
        studentId: { [Op.notIn]: context.students.map((student) => student.id) },
      },
      transaction,
    });
  });
};

const calculateClassResults = async (input, user) => {
  const context = await loadCalculationContext(input, user);
  const calculation = calculateStudents(context);
  await persistResults(context, calculation);
  return {
    exam: context.exam,
    class: context.selectedClass,
    summaries: calculation.summaries,
  };
};

module.exports = { loadCalculationContext, calculateStudents, calculateClassResults };
