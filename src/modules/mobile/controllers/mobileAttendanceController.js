const Attendance = require("../../attendance/models/Attendance");
const Class = require("../../classes/models/Class");
const Student = require("../../students/models/Student");

const uniqueIds = (ids) => [
  ...new Set((ids || []).filter(Boolean).map((id) => id.toString())),
];

exports.getAssignedAttendanceClasses = async (req, res) => {
  try {
    const departmentIds = uniqueIds([
      ...(req.user.departmentIds || []),
      req.user.departmentId,
    ]);

    if (!departmentIds.length) {
      return res.status(200).json({
        message: "Assigned classes fetched successfully",
        summary: {
          departments: 0,
          classes: 0,
          done: 0,
        },
        departments: [],
        classes: [],
      });
    }

    const classes = await Class.find({
      departmentId: { $in: departmentIds },
      isActive: true,
    })
      .populate("departmentId")
      .populate("programId")
      .populate("academicYearId")
      .sort({ createdAt: -1 });

    const classIds = classes.map((classItem) => classItem._id);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const [studentCounts, todayAttendanceStats] = await Promise.all([
      Student.aggregate([
        {
          $match: {
            classId: { $in: classIds },
            isActive: true,
          },
        },
        {
          $group: {
            _id: "$classId",
            count: { $sum: 1 },
          },
        },
      ]),
      Attendance.aggregate([
        {
          $match: {
            classId: { $in: classIds },
            takenBy: req.user._id,
            attendanceDate: {
              $gte: startOfToday,
              $lt: endOfToday,
            },
          },
        },
        {
          $group: {
            _id: {
              classId: "$classId",
              attendanceSession: "$attendanceSession",
            },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const studentCountByClassId = new Map(
      studentCounts.map((item) => [item._id.toString(), item.count])
    );
    const attendanceStatsByClassId = new Map();

    todayAttendanceStats.forEach((item) => {
      const classId = item._id.classId.toString();
      const stats = attendanceStatsByClassId.get(classId) || {
        BeforeBreak: 0,
        AfterBreak: 0,
      };

      stats[item._id.attendanceSession || "BeforeBreak"] = item.count;
      attendanceStatsByClassId.set(classId, stats);
    });

    const departmentsById = new Map();
    const classData = classes.map((classItem) => {
      const department = classItem.departmentId;
      const departmentId = department?._id?.toString();
      const classId = classItem._id.toString();
      const studentsCount = studentCountByClassId.get(classId) || 0;
      const attendanceStats = attendanceStatsByClassId.get(classId) || {
        BeforeBreak: 0,
        AfterBreak: 0,
      };
      const beforeBreakDone =
        studentsCount > 0 && attendanceStats.BeforeBreak >= studentsCount;
      const afterBreakDone =
        studentsCount > 0 && attendanceStats.AfterBreak >= studentsCount;
      const doneToday = beforeBreakDone && afterBreakDone;

      if (departmentId && !departmentsById.has(departmentId)) {
        departmentsById.set(departmentId, {
          id: departmentId,
          name: department.name,
          code: department.code,
        });
      }

      return {
        id: classId,
        name: classItem.name,
        displayCode: department?.code
          ? `${department.code}-${classItem.name.replace(/^class\s+/i, "")}`
          : classItem.name,
        department: department
          ? {
              id: departmentId,
              name: department.name,
              code: department.code,
            }
          : null,
        program: classItem.programId
          ? {
              id: classItem.programId._id,
              name: classItem.programId.name,
            }
          : null,
        academicYear: classItem.academicYearId
          ? {
              id: classItem.academicYearId._id,
              name: classItem.academicYearId.name,
            }
          : null,
        studentsCount,
        attendanceToday: {
          beforeBreak: {
            submitted: attendanceStats.BeforeBreak,
            done: beforeBreakDone,
          },
          afterBreak: {
            submitted: attendanceStats.AfterBreak,
            done: afterBreakDone,
          },
          dayComplete: doneToday,
        },
        doneToday,
      };
    });
    const completedClassesCount = classData.filter(
      (classItem) => classItem.doneToday
    ).length;

    res.status(200).json({
      message: "Assigned classes fetched successfully",
      summary: {
        departments: departmentsById.size,
        classes: classData.length,
        done: completedClassesCount,
      },
      departments: Array.from(departmentsById.values()),
      classes: classData,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

exports.getAssignedClassStudents = async (req, res) => {
  try {
    const departmentIds = uniqueIds([
      ...(req.user.departmentIds || []),
      req.user.departmentId,
    ]);

    const classItem = await Class.findOne({
      _id: req.params.classId,
      departmentId: { $in: departmentIds },
      isActive: true,
    })
      .populate("departmentId")
      .populate("programId")
      .populate("academicYearId");

    if (!classItem) {
      return res.status(404).json({
        message: "Class not found in your assigned departments",
      });
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const [students, todayAttendance] = await Promise.all([
      Student.find({
        classId: classItem._id,
        isActive: true,
      }).sort({ fullName: 1 }),
      Attendance.find({
        classId: classItem._id,
        takenBy: req.user._id,
        attendanceDate: {
          $gte: startOfToday,
          $lt: endOfToday,
        },
      }),
    ]);

    const department = classItem.departmentId;
    const classNameSuffix = classItem.name.replace(/^class\s+/i, "");

    res.status(200).json({
      message: "Class students fetched successfully",
      class: {
        id: classItem._id,
        name: classItem.name,
        displayCode: department?.code
          ? `${department.code}-${classNameSuffix}`
          : classItem.name,
        department: department
          ? {
              id: department._id,
              name: department.name,
              code: department.code,
            }
          : null,
        program: classItem.programId
          ? {
              id: classItem.programId._id,
              name: classItem.programId.name,
            }
          : null,
        academicYear: classItem.academicYearId
          ? {
              id: classItem.academicYearId._id,
              name: classItem.academicYearId.name,
            }
          : null,
      },
      count: students.length,
      students: students.map((student) => {
        const studentAttendance = todayAttendance
          .filter(
            (attendance) =>
              attendance.studentId.toString() === student._id.toString()
          )
          .reduce(
            (sessions, attendance) => ({
              ...sessions,
              [attendance.attendanceSession || "BeforeBreak"]: {
                id: attendance._id,
                status: attendance.status,
                remarks: attendance.remarks,
                attendanceDate: attendance.attendanceDate,
              },
            }),
            {}
          );

        return {
          id: student._id,
          admissionNo: student.admissionNo,
          fullName: student.fullName,
          gender: student.gender,
          photoUrl: student.photoUrl,
          status: student.status,
          attendanceToday: {
            beforeBreak: studentAttendance.BeforeBreak || null,
            afterBreak: studentAttendance.AfterBreak || null,
            dayComplete: Boolean(
              studentAttendance.BeforeBreak && studentAttendance.AfterBreak
            ),
          },
        };
      }),
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
