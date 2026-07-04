const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
    },

    role: {
      type: String,
      required: true,
      enum: [
        "SuperAdmin",
        "Director",
        "DeputyDirector",
        "HeadDepartment",
        "AttendanceTaker",
        "ExamManager",
      ],
    },

    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },

    departmentIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Department",
      },
    ],

    attendanceShift: {
      type: String,
      enum: ["Morning", "Afternoon", "All"],
      default: "All",
      set: (value) => {
        const normalizedValue = String(value || "").trim().toLowerCase();

        if (normalizedValue === "all") return "All";
        if (normalizedValue === "morning") return "Morning";
        if (normalizedValue === "afternoon") return "Afternoon";

        return value;
      },
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

module.exports = mongoose.model("User", userSchema);
