const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },

    academicYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicYear",
      required: true,
    },

    termId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Term",
      default: null,
    },

    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },

    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true,
    },

    attendanceDate: {
      type: Date,
      required: true,
    },

    attendanceSession: {
      type: String,
      enum: ["BeforeBreak", "AfterBreak"],
      default: "BeforeBreak",
      required: true,
    },

    status: {
      type: String,
      enum: ["Present", "Absent", "Permission"],
      required: true,
    },

    remarks: {
      type: String,
      default: "",
    },

    takenBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

attendanceSchema.index(
  { studentId: 1, attendanceDate: 1, classId: 1, attendanceSession: 1 },
  { unique: true }
);

module.exports = mongoose.model("Attendance", attendanceSchema);
