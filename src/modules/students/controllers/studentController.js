const Student = require("../models/Student");
const ClassSection = require("../../classSections/models/ClassSection");

const validateClassSection = async (data, currentStudent = null) => {
  if (
    currentStudent &&
    data.classId !== undefined &&
    String(data.classId) !== String(currentStudent.classId) &&
    data.classSectionId === undefined
  ) {
    data.classSectionId = null;
    return;
  }

  if (data.classSectionId === undefined || data.classSectionId === null || data.classSectionId === "") {
    return;
  }

  const section = await ClassSection.findById(data.classSectionId);
  const classId = data.classId || currentStudent?.classId;
  if (!section || String(section.classId) !== String(classId)) {
    const error = new Error("Class section does not belong to the selected class");
    error.status = 400;
    throw error;
  }
};

const buildFileUrl = (req, file) =>
  `${req.protocol}://${req.get("host")}/uploads/students/${file.destination
    .split(/[\\/]/)
    .pop()}/${file.filename}`;

const addUploadedFileUrls = (req) => {
  if (!req.files) {
    return;
  }

  const fileFields = {
    photo: "photoUrl",
    notaryDocument: "notaryDocumentUrl",
    certificateDocument: "certificateDocumentUrl",
  };

  Object.entries(fileFields).forEach(([fileField, bodyField]) => {
    const file = req.files[fileField]?.[0];

    if (file) {
      req.body[bodyField] = buildFileUrl(req, file);
    }
  });
};

// Create Student
exports.createStudent = async (req, res) => {
  try {
    addUploadedFileUrls(req);
    await validateClassSection(req.body);

    const student = await Student.create(req.body);

    res.status(201).json({
      message: "Student created successfully",
      data: student,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message,
    });
  }
};

// Get All Students
exports.getStudents = async (req, res) => {
  try {
    const students = await Student.find()
      .populate("academicYearId")
      .populate("programId")
      .populate("departmentId")
      .populate("classId")
      .populate("classSectionId")
      .sort({ createdAt: -1 });

    res.status(200).json({
      count: students.length,
      data: students,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Get Student By Id
exports.getStudentById = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id)
      .populate("academicYearId")
      .populate("programId")
      .populate("departmentId")
      .populate("classId")
      .populate("classSectionId");

    if (!student) {
      return res.status(404).json({
        message: "Student not found",
      });
    }

    res.status(200).json({
      data: student,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Update Student
exports.updateStudent = async (req, res) => {
  try {
    addUploadedFileUrls(req);
    const currentStudent = await Student.findById(req.params.id);

    if (!currentStudent) {
      return res.status(404).json({ message: "Student not found" });
    }

    await validateClassSection(req.body, currentStudent);

    const student = await Student.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    )
      .populate("academicYearId")
      .populate("programId")
      .populate("departmentId")
      .populate("classId")
      .populate("classSectionId");

    if (!student) {
      return res.status(404).json({
        message: "Student not found",
      });
    }

    res.status(200).json({
      message: "Student updated successfully",
      data: student,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message,
    });
  }
};

// Delete Student
exports.deleteStudent = async (req, res) => {
  try {
    const student = await Student.findByIdAndDelete(req.params.id);

    if (!student) {
      return res.status(404).json({
        message: "Student not found",
      });
    }

    res.status(200).json({
      message: "Student deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Get Students By Class
exports.getStudentsByClass = async (req, res) => {
  try {
    const filters = {
      classId: req.params.classId,
      isActive: true,
    };
    if (req.query.classSectionId) filters.classSectionId = req.query.classSectionId;

    const students = await Student.find(filters)
      .populate("departmentId")
      .populate("classId")
      .populate("classSectionId")
      .sort({ fullName: 1 });

    res.status(200).json({
      count: students.length,
      data: students,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Bulk Upload Students
exports.bulkUploadStudents = async (req, res) => {
  try {
    const students = req.body.students;

    if (!students || !Array.isArray(students)) {
      return res.status(400).json({
        message: "Students must be an array",
      });
    }

    const insertedStudents = await Student.insertMany(students, {
      ordered: false,
    });

    res.status(201).json({
      message: "Students uploaded successfully",
      count: insertedStudents.length,
      data: insertedStudents,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
