const ClassSection = require("../models/ClassSection");
const Class = require("../../classes/models/Class");
const Student = require("../../students/models/Student");

const handleError = (res, error) => {
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(400).json({ message: "This section already exists for the class" });
  }
  return res.status(error.status || 500).json({ message: error.message });
};

const ensureClass = async (classId) => {
  const parentClass = await Class.findById(classId);
  if (!parentClass) {
    const error = new Error("Class not found");
    error.status = 400;
    throw error;
  }
};

exports.createClassSection = async (req, res) => {
  try {
    await ensureClass(req.body.classId);
    const section = await ClassSection.create(req.body);
    res.status(201).json({ message: "Class section created successfully", data: section });
  } catch (error) { handleError(res, error); }
};

exports.getClassSections = async (req, res) => {
  try {
    const filters = {};
    if (req.query.classId) filters.classId = req.query.classId;
    if (req.query.isActive !== undefined) filters.isActive = req.query.isActive === "true";
    const sections = await ClassSection.find(filters).populate("classId").sort({ name: 1 });
    res.json({ count: sections.length, data: sections });
  } catch (error) { handleError(res, error); }
};

exports.getClassSectionById = async (req, res) => {
  try {
    const section = await ClassSection.findById(req.params.id).populate("classId");
    if (!section) return res.status(404).json({ message: "Class section not found" });
    res.json({ data: section });
  } catch (error) { handleError(res, error); }
};

exports.updateClassSection = async (req, res) => {
  try {
    if (req.body.classId) await ensureClass(req.body.classId);
    const section = await ClassSection.findByIdAndUpdate(req.params.id, req.body);
    if (!section) return res.status(404).json({ message: "Class section not found" });
    res.json({ message: "Class section updated successfully", data: section });
  } catch (error) { handleError(res, error); }
};

exports.deleteClassSection = async (req, res) => {
  try {
    const assignedStudent = await Student.findOne({ classSectionId: req.params.id });
    if (assignedStudent) {
      return res.status(409).json({ message: "Cannot delete a section that has students" });
    }
    const section = await ClassSection.findByIdAndDelete(req.params.id);
    if (!section) return res.status(404).json({ message: "Class section not found" });
    res.json({ message: "Class section deleted successfully" });
  } catch (error) { handleError(res, error); }
};
