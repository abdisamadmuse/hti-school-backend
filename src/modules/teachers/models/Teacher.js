const mongoose = require("mongoose");

const teacherSchema = new mongoose.Schema(
  {
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

    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },

    address: {
      type: String,
    },

    qualification: {
      type: String,
    },

    teacherType: {
      type: String,
      enum: ["General", "Core"],
      required: true,
    },

    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      validate: {
        validator: function (value) {
          if (this.teacherType === "Core") {
            return value != null;
          }
          if (this.teacherType === "General") {
            return value == null;
          }
          return true;
        },
        message:
          "Core teachers must have a departmentId; general teachers must not have one.",
      },
    },

    // subjectIds removed; assignments handled in separate collection

    academicYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicYear",
      required: true,
    },

    hireDate: {
      type: Date,
    },

    photoUrl: {
      type: String,
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

module.exports = mongoose.model("Teacher", teacherSchema);
