const { subjectDefaults } = require("../../examMarks/services/assessment");
const Subject = require("../models/Subject");

// Create Subject
exports.createSubject = async (req, res) => {
  try {
    const {
      name,
      code,
      subjectType,
      departmentId,
      isActive,
    } = req.body;

    if (subjectType === "Core" && !departmentId) {
      return res.status(400).json({
        message: "Core subject must have departmentId",
      });
    }

    if (subjectType === "General" && departmentId) {
      return res.status(400).json({
        message: "General subject should not have departmentId",
      });
    }

    const subject = await Subject.create({
      name,
      code,
      subjectType,
      departmentId: subjectType === "General" ? null : departmentId,
      ...subjectDefaults(req.body),
      isActive,
    });

    res.status(201).json({
      message: "Subject created successfully",
      data: subject,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message,
    });
  }
};

// Get All Subjects
exports.getSubjects = async (req, res) => {
  try {
    const subjects = await Subject.find()
      .populate("departmentId")
      .sort({ createdAt: -1 });

    res.status(200).json({
      count: subjects.length,
      data: subjects,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message,
    });
  }
};

// Get Subject By Id
exports.getSubjectById = async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id).populate("departmentId");

    if (!subject) {
      return res.status(404).json({
        message: "Subject not found",
      });
    }

    res.status(200).json({
      data: subject,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message,
    });
  }
};

// Update Subject
exports.updateSubject = async (req, res) => {
  try {
    const current = await Subject.findById(req.params.id);
    if (!current) return res.status(404).json({ message: "Subject not found" });
    const merged = { ...current, ...req.body };
    const { subjectType, departmentId } = merged;

    if (subjectType === "Core" && !departmentId) {
      return res.status(400).json({
        message: "Core subject must have departmentId",
      });
    }

    if (subjectType === "General" && departmentId) {
      return res.status(400).json({
        message: "General subject should not have departmentId",
      });
    }

    const assessmentFields = ["subjectType", "hasTheory", "hasPractical", "theoryMaxMarks", "practicalMaxMarks", "hasMonthlyAssessment", "monthlyAssessmentMaxMarks", "passMark"];
    const updateData = { ...req.body };
    if (assessmentFields.some((key) => Object.hasOwn(req.body, key))) Object.assign(updateData, subjectDefaults(merged));

    if (subjectType === "General") {
      updateData.departmentId = null;
    }

    const subject = await Subject.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).populate("departmentId");

    if (!subject) {
      return res.status(404).json({
        message: "Subject not found",
      });
    }

    res.status(200).json({
      message: "Subject updated successfully",
      data: subject,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message,
    });
  }
};

// Delete Subject
exports.deleteSubject = async (req, res) => {
  try {
    const subject = await Subject.findByIdAndDelete(req.params.id);

    if (!subject) {
      return res.status(404).json({
        message: "Subject not found",
      });
    }

    res.status(200).json({
      message: "Subject deleted successfully",
    });
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message,
    });
  }
};

// Get General Subjects
exports.getGeneralSubjects = async (req, res) => {
  try {
    const subjects = await Subject.find({
      subjectType: "General",
      isActive: true,
    }).sort({ name: 1 });

    res.status(200).json({
      count: subjects.length,
      data: subjects,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message,
    });
  }
};

// Get Core Subjects By Department
exports.getCoreSubjects = async (req, res) => {
  try {
    const subjects = await Subject.find({
      subjectType: "Core",
      departmentId: req.params.departmentId,
      isActive: true,
    })
      .populate("departmentId")
      .sort({ name: 1 });

    res.status(200).json({
      count: subjects.length,
      data: subjects,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message,
    });
  }
};
