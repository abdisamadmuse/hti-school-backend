const mongoose = require("mongoose");

const studentSchema = new mongoose.Schema(
  {
    admissionNo: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    gender: {
      type: String,
      enum: ["Male", "Female"],
      required: true,
    },

    dateOfBirth: {
      type: Date,
    },

    phone: {
      type: String,
    },

    address: {
      type: String,
    },

    parentName: {
      type: String,
      required: true,
    },

    parentPhone: {
      type: String,
      required: true,
    },

    parentRelationship: {
      type: String,
      enum: ["Father", "Mother", "Guardian", "Other"],
      default: "Guardian",
    },

    academicYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicYear",
      required: true,
    },

    programId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Program",
      required: true,
    },

    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true,
    },

    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },

    photoUrl: {
      type: String,
    },

    notaryDocumentUrl: {
      type: String,
    },

    certificateDocumentUrl: {
      type: String,
    },

    status: {
      type: String,
      enum: ["Active", "Graduated", "Dropped", "Transferred", "Suspended"],
      default: "Active",
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Student", studentSchema);
