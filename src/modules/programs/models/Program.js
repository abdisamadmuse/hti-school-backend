const mongoose = require("mongoose");

const programSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      enum: ["Secondary", "Vocational"],
    },

    duration: {
      type: Number,
      required: true,
    },

    durationType: {
      type: String,
      required: true,
      enum: ["Years", "Months"],
    },

    description: {
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

module.exports = mongoose.model("Program", programSchema);
