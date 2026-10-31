const ExamSubject = require("../models/ExamSubject");
const Exam = require("../../exams/models/Exam");
const Class = require("../../classes/models/Class");
const Subject = require("../../subjects/models/Subject");

const populateExamSubject = (query) =>
  query
    .populate("examId")
    .populate("classId")
    .populate("subjectId")
    .populate("departmentId");

const getFilters = (query, examId) => {
  const filters = {};
  const selectedExamId = examId || query.examId;
  if (selectedExamId) filters.examId = selectedExamId;
  ["classId", "subjectId", "departmentId", "isActive"].forEach((field) => {
    if (query[field] !== undefined && query[field] !== "") {
      filters[field] =
        field === "isActive" ? query[field] === "true" : query[field];
    }
  });
  return filters;
};

const requireDraftExam = async (examId) => {
  const exam = await Exam.findById(examId);
  if (!exam) {
    const error = new Error("Exam not found");
    error.status = 400;
    throw error;
  }
  if (exam.status !== "Draft") {
    const error = new Error("Exam subjects can only be changed while the exam is in Draft status");
    error.status = 409;
    throw error;
  }
  return exam;
};

const booleanValue = (value, defaultValue) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
};

const buildConfiguration = async (data, current = null) => {
  const { examId, classId, subjectId } = data;
  if (!examId || !classId || !subjectId) {
    const error = new Error("examId, classId and subjectId are required");
    error.status = 400;
    throw error;
  }

  const [exam, selectedClass, subject] = await Promise.all([
    requireDraftExam(examId),
    Class.findById(classId),
    Subject.findById(subjectId),
  ]);

  if (!selectedClass) {
    const error = new Error("Class not found");
    error.status = 400;
    throw error;
  }
  if (!subject) {
    const error = new Error("Subject not found");
    error.status = 400;
    throw error;
  }
  if (!selectedClass.isActive || !subject.isActive) {
    const error = new Error("The selected class and subject must be active");
    error.status = 400;
    throw error;
  }
  if (Number(selectedClass.academicYearId) !== Number(exam.academicYearId)) {
    const error = new Error("The selected class does not belong to the exam academic year");
    error.status = 400;
    throw error;
  }
  if (
    subject.subjectType === "Core" &&
    Number(subject.departmentId) !== Number(selectedClass.departmentId)
  ) {
    const error = new Error("A core subject can only be assigned to a class in the same department");
    error.status = 400;
    throw error;
  }

  const { configuration } = require("../../examMarks/services/assessment");
  const assessment = configuration({
    hasTheory: current?.hasTheory ?? subject.hasTheory,
    hasPractical: current?.hasPractical ?? subject.hasPractical,
    hasMonthlyAssessment: data.hasMonthlyAssessment ?? subject.hasMonthlyAssessment ?? false,
    theoryMaxMarks: data.theoryMaxMarks ?? subject.theoryMaxMarks,
    practicalMaxMarks: data.practicalMaxMarks ?? subject.practicalMaxMarks,
    monthlyAssessmentMaxMarks: data.monthlyAssessmentMaxMarks ?? subject.monthlyAssessmentMaxMarks,
    passMark: data.passMark ?? subject.passMark,
  });

  return {
    examId: Number(examId),
    classId: Number(classId),
    subjectId: Number(subjectId),
    departmentId: Number(selectedClass.departmentId),
    ...assessment,
    isActive: booleanValue(data.isActive, true),
  };
};

const handleError = (res, error) => {
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({
      message: "This subject is already configured for the selected exam and class",
    });
  }
  if (error.name === "SequelizeValidationError") {
    return res.status(400).json({
      message: error.errors?.[0]?.message || error.message,
    });
  }
  return res.status(error.status || 500).json({ message: error.message });
};

exports.createExamSubject = async (req, res) => {
  try {
    const examId = req.params.examId || req.body.examId;
    const configuration = await buildConfiguration({ ...req.body, examId });
    const examSubject = await ExamSubject.create(configuration);
    const populated = await populateExamSubject(
      ExamSubject.findById(examSubject._id)
    );

    res.status(201).json({
      message: "Exam subject configured successfully",
      data: populated,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.getExamSubjects = async (req, res) => {
  try {
    const examSubjects = await populateExamSubject(
      ExamSubject.find(getFilters(req.query, req.params.examId)).sort({
        createdAt: -1,
      })
    );
    res.status(200).json({
      count: examSubjects.length,
      data: examSubjects,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.getExamSubjectById = async (req, res) => {
  try {
    const examSubject = await populateExamSubject(
      ExamSubject.findById(req.params.id)
    );
    if (!examSubject) {
      return res.status(404).json({ message: "Exam subject not found" });
    }
    res.status(200).json({ data: examSubject });
  } catch (error) {
    handleError(res, error);
  }
};

exports.updateExamSubject = async (req, res) => {
  try {
    const current = await ExamSubject.findById(req.params.id);
    if (!current) {
      return res.status(404).json({ message: "Exam subject not found" });
    }

    const configuration = await buildConfiguration({
      ...current,
      ...req.body,
      examId: current.examId,
      classId: current.classId,
      subjectId: current.subjectId,
    }, current);
    const examSubject = await populateExamSubject(
      ExamSubject.findByIdAndUpdate(req.params.id, configuration)
    );
    res.status(200).json({
      message: "Exam subject updated successfully",
      data: examSubject,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.deleteExamSubject = async (req, res) => {
  try {
    const current = await ExamSubject.findById(req.params.id);
    if (!current) {
      return res.status(404).json({ message: "Exam subject not found" });
    }
    await requireDraftExam(current.examId);
    await ExamSubject.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Exam subject removed successfully" });
  } catch (error) {
    handleError(res, error);
  }
};
