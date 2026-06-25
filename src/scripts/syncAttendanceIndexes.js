require("dotenv").config();

const mongoose = require("mongoose");

const Attendance = require("../modules/attendance/models/Attendance");

const syncAttendanceIndexes = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const indexes = await Attendance.syncIndexes();

    console.log("Attendance indexes synced:", indexes);
  } catch (error) {
    console.error("Failed to sync attendance indexes:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

syncAttendanceIndexes();
