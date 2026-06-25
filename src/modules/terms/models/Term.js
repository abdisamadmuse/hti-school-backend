const mongoose = require("mongoose");

const termSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      enum: ["Term 1", "Term 2"],
    },

    academicYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicYear",
      required: true,
    },

    startDate: {
      type: Date,
      required: true,
    },

    endDate: {
      type: Date,
      required: true,
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

module.exports = mongoose.model("Term", termSchema);
