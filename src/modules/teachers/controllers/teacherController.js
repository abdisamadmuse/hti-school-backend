const Teacher = require("../models/Teacher");
const User = require("../../users/models/User");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { sequelize, initializeModels } = require("../../../config/mysql");

// Create a login for an existing teacher. The phone number is the username.
exports.createTeacherAttendanceAccount = async (req, res) => {
  try {
    const teacher = await Teacher.findById(req.params.id);
    if (!teacher) return res.status(404).json({ message: "Teacher not found" });
    if (!teacher.phone) return res.status(400).json({ message: "Add a phone number to the teacher profile first" });

    const existing = await User.findOne({ $or: [{ teacherId: teacher.id }, { phone: teacher.phone }] });
    if (existing) {
      const reason = Number(existing.teacherId) === Number(teacher.id)
        ? "This teacher already has a login account"
        : "This phone number is already used by another account";
      return res.status(409).json({ message: reason });
    }

    const suppliedPassword = req.body?.password;
    if (suppliedPassword !== undefined && (typeof suppliedPassword !== "string" || suppliedPassword.length < 8)) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }
    const temporaryPassword = suppliedPassword || crypto.randomBytes(12).toString("base64url");
    const hashedPassword = await bcrypt.hash(temporaryPassword, 12);
    const { User: UserModel } = initializeModels();
    const account = await sequelize.transaction(async (transaction) => UserModel.create({
      fullName: teacher.fullName,
      email: null,
      phone: teacher.phone,
      password: hashedPassword,
      role: "AttendanceTaker",
      departmentId: teacher.departmentId || null,
      departmentIds: teacher.departmentId ? [teacher.departmentId] : [],
      teacherId: teacher.id,
      attendanceShift: "All",
    }, { transaction }));

    res.status(201).json({
      message: "Teacher attendance login created. Share the temporary password securely; it will not be shown again.",
      data: {
        user: {
          id: account.id,
          fullName: account.fullName,
          username: account.phone,
          phone: account.phone,
          role: account.role,
          teacherId: account.teacherId,
        },
        temporaryPassword,
      },
    });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ message: "An account already uses this teacher or phone number" });
    }
    res.status(500).json({ message: error.message });
  }
};

// Create Teacher
exports.createTeacher = async (req, res) => {
  try {
    const { teacherType, departmentId } = req.body;

    if (teacherType === "Core" && !departmentId) {
      return res.status(400).json({
        message: "Core teachers must have a departmentId",
      });
    }

    if (teacherType === "General" && departmentId) {
      return res.status(400).json({
        message: "General teachers should not have a departmentId",
      });
    }

    const teacher = await Teacher.create(req.body);

    res.status(201).json({
      message: "Teacher created successfully",
      data: teacher,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Get All Teachers
exports.getTeachers = async (req, res) => {
  try {
    const teachers = await Teacher.find()
      .populate("departmentId")
      .populate("academicYearId")
      .sort({ createdAt: -1 });

    res.status(200).json({
      count: teachers.length,
      data: teachers,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Get Teacher By Id
exports.getTeacherById = async (req, res) => {
  try {
    const teacher = await Teacher.findById(req.params.id)
      .populate("departmentId")
      .populate("academicYearId");

    if (!teacher) {
      return res.status(404).json({
        message: "Teacher not found",
      });
    }

    res.status(200).json({
      data: teacher,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Update Teacher
exports.updateTeacher = async (req, res) => {
  try {
    const existingTeacher = await Teacher.findById(req.params.id);

    if (!existingTeacher) {
      return res.status(404).json({
        message: "Teacher not found",
      });
    }

    const teacherType = req.body.teacherType || existingTeacher.teacherType;
    const departmentId =
      req.body.departmentId !== undefined
        ? req.body.departmentId
        : existingTeacher.departmentId;

    if (teacherType === "Core" && !departmentId) {
      return res.status(400).json({
        message: "Core teachers must have a departmentId",
      });
    }

    if (teacherType === "General" && departmentId) {
      return res.status(400).json({
        message: "General teachers should not have a departmentId",
      });
    }

    const updateData = { ...req.body };
    if (teacherType === "General") {
      updateData.departmentId = null;
    }

    const teacher = await Teacher.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    )
      .populate("departmentId")
      .populate("academicYearId");

    if (!teacher) {
      return res.status(404).json({
        message: "Teacher not found",
      });
    }

    res.status(200).json({
      message: "Teacher updated successfully",
      data: teacher,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Delete Teacher
exports.deleteTeacher = async (req, res) => {
  try {
    const teacher = await Teacher.findByIdAndDelete(req.params.id);

    if (!teacher) {
      return res.status(404).json({
        message: "Teacher not found",
      });
    }

    res.status(200).json({
      message: "Teacher deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Get Teachers By Department
exports.getTeachersByDepartment = async (req, res) => {
  try {
    const teachers = await Teacher.find({
      departmentId: req.params.departmentId,
      isActive: true,
    })
      .populate("departmentId")
      .populate("academicYearId")
      .sort({ fullName: 1 });

    res.status(200).json({
      count: teachers.length,
      data: teachers,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
