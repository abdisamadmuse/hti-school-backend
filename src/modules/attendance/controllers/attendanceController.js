const Attendance = require("../models/Attendance");

const populateAttendance = (query) =>
  query
    .populate("studentId")
    .populate("academicYearId")
    .populate("termId")
    .populate("classId")
    .populate("departmentId")
    .populate({
      path: "takenBy",
      select: "-password",
    });

const buildFilters = (query) => {
  const filters = {};
  const allowedFilters = [
    "studentId",
    "academicYearId",
    "termId",
    "classId",
    "departmentId",
    "status",
    "attendanceSession",
  ];

  allowedFilters.forEach((field) => {
    if (query[field]) {
      filters[field] = query[field];
    }
  });

  if (query.attendanceDate) {
    const start = new Date(query.attendanceDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    filters.attendanceDate = {
      $gte: start,
      $lt: end,
    };
  }

  return filters;
};

const handleError = (res, error) => {
  if (error.code === 11000) {
    return res.status(400).json({
      message:
        "Attendance already exists for this student, date, class, and session",
    });
  }

  res.status(500).json({
    message: error.message,
  });
};

exports.createAttendance = async (req, res) => {
  try {
    const attendance = await Attendance.create(req.body);
    const populatedAttendance = await populateAttendance(
      Attendance.findById(attendance._id)
    );

    res.status(201).json({
      message: "Attendance created successfully",
      data: populatedAttendance,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.bulkAttendance = async (req, res) => {
  try {
    const attendances = req.body.attendances;

    if (!attendances || !Array.isArray(attendances)) {
      return res.status(400).json({
        message: "Attendances must be an array",
      });
    }

    const insertedAttendances = await Attendance.insertMany(attendances, {
      ordered: false,
    });

    const populatedAttendances = await populateAttendance(
      Attendance.find({
        _id: {
          $in: insertedAttendances.map((attendance) => attendance._id),
        },
      }).sort({ attendanceDate: -1, createdAt: -1 })
    );

    res.status(201).json({
      message: "Attendance uploaded successfully",
      count: populatedAttendances.length,
      data: populatedAttendances,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.getAttendance = async (req, res) => {
  try {
    const attendance = await populateAttendance(
      Attendance.find(buildFilters(req.query)).sort({
        attendanceDate: -1,
        createdAt: -1,
      })
    );

    res.status(200).json({
      message: "Attendance fetched successfully",
      count: attendance.length,
      data: attendance,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.getAttendanceByClass = async (req, res) => {
  try {
    const attendance = await populateAttendance(
      Attendance.find({
        ...buildFilters(req.query),
        classId: req.params.classId,
      }).sort({ attendanceDate: -1, createdAt: -1 })
    );

    res.status(200).json({
      message: "Class attendance fetched successfully",
      count: attendance.length,
      data: attendance,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.getAttendanceByStudent = async (req, res) => {
  try {
    const attendance = await populateAttendance(
      Attendance.find({
        ...buildFilters(req.query),
        studentId: req.params.studentId,
      }).sort({ attendanceDate: -1, createdAt: -1 })
    );

    res.status(200).json({
      message: "Student attendance fetched successfully",
      count: attendance.length,
      data: attendance,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.updateAttendance = async (req, res) => {
  try {
    const attendance = await populateAttendance(
      Attendance.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      })
    );

    if (!attendance) {
      return res.status(404).json({
        message: "Attendance not found",
      });
    }

    res.status(200).json({
      message: "Attendance updated successfully",
      data: attendance,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.deleteAttendance = async (req, res) => {
  try {
    const attendance = await Attendance.findByIdAndDelete(req.params.id);

    if (!attendance) {
      return res.status(404).json({
        message: "Attendance not found",
      });
    }

    res.status(200).json({
      message: "Attendance deleted successfully",
      data: attendance,
    });
  } catch (error) {
    handleError(res, error);
  }
};
