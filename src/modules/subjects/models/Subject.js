const mongoose = require("mongoose");

const subjectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },

    subjectType: {
      type: String,
      required: true,
      enum: ["General", "Core"],
    },

    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },

    hasTheory: {
      type: Boolean,
      default: true,
    },

    hasPractical: {
      type: Boolean,
      default: false,
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

subjectSchema.index({ code: 1, departmentId: 1 }, { unique: true });

module.exports = mongoose.model("Subject", subjectSchema);
