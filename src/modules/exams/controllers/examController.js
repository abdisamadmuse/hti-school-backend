const Exam = require("../models/Exam");
const AcademicYear = require("../../academicYears/models/AcademicYear");
const Term = require("../../terms/models/Term");

const ALLOWED_STATUSES = ["Draft", "Open", "Published", "Closed"];
const STATUS_TRANSITIONS = {
  Draft: ["Open"],
  Open: ["Draft", "Published", "Closed"],
  Published: ["Open", "Closed"],
  Closed: ["Open"],
};

const populateExam = (query) =>
  query
    .populate("academicYearId")
    .populate("termId")
    .populate({ path: "createdBy", select: "-password" });

const getFilters = (query) => {
  const filters = {};
  ["academicYearId", "termId", "examType", "status"].forEach((field) => {
    if (query[field] !== undefined && query[field] !== "") {
      filters[field] = query[field];
    }
  });
  return filters;
};

const validateReferences = async (data, currentExam = null) => {
  const academicYearId = data.academicYearId || currentExam?.academicYearId;
  const termId = data.termId || currentExam?.termId;

  if (!academicYearId) {
    const error = new Error("academicYearId is required");
    error.status = 400;
    throw error;
  }
  if (!termId) {
    const error = new Error("termId is required");
    error.status = 400;
    throw error;
  }

  const [academicYear, term] = await Promise.all([
    AcademicYear.findById(academicYearId),
    Term.findById(termId),
  ]);

  if (!academicYear) {
    const error = new Error("Academic year not found");
    error.status = 400;
    throw error;
  }
  if (!term) {
    const error = new Error("Term not found");
    error.status = 400;
    throw error;
  }
  if (Number(term.academicYearId) !== Number(academicYearId)) {
    const error = new Error("The selected term does not belong to the selected academic year");
    error.status = 400;
    throw error;
  }
};

const handleError = (res, error) => {
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({
      message: "An exam with this name already exists for the selected academic year and term",
    });
  }
  if (error.name === "SequelizeValidationError") {
    return res.status(400).json({
      message: error.errors?.[0]?.message || error.message,
    });
  }
  return res.status(error.status || 500).json({ message: error.message });
};

exports.createExam = async (req, res) => {
  try {
    await validateReferences(req.body);
    const exam = await Exam.create({
      ...req.body,
      status: "Draft",
      resultsPublished: false,
      createdBy: req.user._id,
    });
    const populated = await populateExam(Exam.findById(exam._id));

    res.status(201).json({
      message: "Exam created successfully",
      data: populated,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.getExams = async (req, res) => {
  try {
    const exams = await populateExam(
      Exam.find(getFilters(req.query)).sort({ createdAt: -1 })
    );
    res.status(200).json({ count: exams.length, data: exams });
  } catch (error) {
    handleError(res, error);
  }
};

exports.getExamById = async (req, res) => {
  try {
    const exam = await populateExam(Exam.findById(req.params.id));
    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }
    res.status(200).json({ data: exam });
  } catch (error) {
    handleError(res, error);
  }
};

exports.updateExam = async (req, res) => {
  try {
    const currentExam = await Exam.findById(req.params.id);
    if (!currentExam) {
      return res.status(404).json({ message: "Exam not found" });
    }
    if (currentExam.status !== "Draft") {
      return res.status(409).json({
        message: "Only draft exams can be edited. Change the exam status to Draft first",
      });
    }

    const protectedFields = ["status", "resultsPublished", "createdBy"];
    const updateData = Object.fromEntries(
      Object.entries(req.body).filter(([key]) => !protectedFields.includes(key))
    );
    await validateReferences(updateData, currentExam);

    const exam = await populateExam(
      Exam.findByIdAndUpdate(req.params.id, updateData)
    );
    res.status(200).json({
      message: "Exam updated successfully",
      data: exam,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.updateExamStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (status === "Published") {
      return res.status(400).json({
        message: "Use the dedicated /api/exams/:examId/publish endpoint so result completeness can be checked",
      });
    }
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `status must be one of: ${ALLOWED_STATUSES.join(", ")}`,
      });
    }

    const currentExam = await Exam.findById(req.params.id);
    if (!currentExam) {
      return res.status(404).json({ message: "Exam not found" });
    }
    if (currentExam.status === status) {
      return res.status(200).json({
        message: `Exam is already ${status}`,
        data: await populateExam(Exam.findById(req.params.id)),
      });
    }
    if (!STATUS_TRANSITIONS[currentExam.status]?.includes(status)) {
      return res.status(409).json({
        message: `Exam status cannot change directly from ${currentExam.status} to ${status}`,
      });
    }

    const exam = await populateExam(
      Exam.findByIdAndUpdate(req.params.id, {
        status,
        resultsPublished: status === "Published",
      })
    );
    res.status(200).json({
      message: `Exam status changed to ${status}`,
      data: exam,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.deleteExam = async (req, res) => {
  try {
    const currentExam = await Exam.findById(req.params.id);
    if (!currentExam) {
      return res.status(404).json({ message: "Exam not found" });
    }
    if (currentExam.status !== "Draft") {
      return res.status(409).json({
        message: "Only draft exams can be deleted",
      });
    }

    await Exam.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Exam deleted successfully" });
  } catch (error) {
    handleError(res, error);
  }
};
