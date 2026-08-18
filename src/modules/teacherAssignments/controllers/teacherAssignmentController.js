const TeacherAssignment = require("../models/TeacherAssignment");

const populateAssignment = (query) =>
  query
    .populate("teacherId")
    .populate("subjectId")
    .populate("classId")
    .populate("departmentId")
    .populate("academicYearId")
    .populate("termId");

const filtersFromQuery = (query) => {
  const filters = {};
  [
    "teacherId",
    "subjectId",
    "classId",
    "departmentId",
    "academicYearId",
    "termId",
    "isActive",
  ].forEach((field) => {
    if (query[field] !== undefined && query[field] !== "") {
      filters[field] =
        field === "isActive" ? query[field] === "true" : query[field];
    }
  });
  return filters;
};

const handleError = (res, error) => {
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(400).json({
      message: "This teacher assignment already exists",
    });
  }

  res.status(500).json({ message: error.message });
};

exports.createTeacherAssignment = async (req, res) => {
  try {
    const assignment = await TeacherAssignment.create(req.body);
    const populated = await populateAssignment(
      TeacherAssignment.findById(assignment._id)
    );

    res.status(201).json({
      message: "Teacher assignment created successfully",
      data: populated,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.getTeacherAssignments = async (req, res) => {
  try {
    const assignments = await populateAssignment(
      TeacherAssignment.find(filtersFromQuery(req.query)).sort({ createdAt: -1 })
    );

    res.status(200).json({ count: assignments.length, data: assignments });
  } catch (error) {
    handleError(res, error);
  }
};

exports.getTeacherAssignmentById = async (req, res) => {
  try {
    const assignment = await populateAssignment(
      TeacherAssignment.findById(req.params.id)
    );

    if (!assignment) {
      return res.status(404).json({ message: "Teacher assignment not found" });
    }

    res.status(200).json({ data: assignment });
  } catch (error) {
    handleError(res, error);
  }
};

exports.updateTeacherAssignment = async (req, res) => {
  try {
    const assignment = await populateAssignment(
      TeacherAssignment.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      })
    );

    if (!assignment) {
      return res.status(404).json({ message: "Teacher assignment not found" });
    }

    res.status(200).json({
      message: "Teacher assignment updated successfully",
      data: assignment,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.deleteTeacherAssignment = async (req, res) => {
  try {
    const assignment = await TeacherAssignment.findByIdAndDelete(req.params.id);

    if (!assignment) {
      return res.status(404).json({ message: "Teacher assignment not found" });
    }

    res.status(200).json({ message: "Teacher assignment deleted successfully" });
  } catch (error) {
    handleError(res, error);
  }
};
