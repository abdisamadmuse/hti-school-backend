const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../../users/models/User");
const Teacher = require("../../teachers/models/Teacher");

const getAttendanceShift = (data) =>
  data.attendanceShift ||
  data.attendance_shift ||
  data.attendanceShiftId ||
  data.attendance_shiftId ||
  data.attendance_shift_id ||
  data.shift;

// Generate JWT Token
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id ?? user._id,
      role: user.role,
      departmentId: user.departmentId,
      departmentIds: user.departmentIds || [],
      teacherId: user.teacherId || null,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "30d",
    }
  );
};

// Register User
const registerUser = async (req, res) => {
  try {
    const { fullName, email, phone, password, role, departmentId, departmentIds, teacherId } =
      req.body;
    const attendanceShift = getAttendanceShift(req.body);
    if (role === "Teacher" && !teacherId) return res.status(400).json({ message: "Select a teacher profile for this Teacher account" });
    if (teacherId && !await Teacher.findById(teacherId)) {
      return res.status(400).json({ message: "Selected teacher was not found" });
    }

    // Check existing user
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }],
    });

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const normalizedDepartmentIds = Array.isArray(departmentIds)
      ? departmentIds.filter(Boolean)
      : departmentId
      ? [departmentId]
      : [];

    // Create user
    const user = await User.create({
      fullName,
      email,
      phone,
      password: hashedPassword,
      role,
      departmentId: departmentId || normalizedDepartmentIds[0] || null,
      departmentIds: normalizedDepartmentIds,
      teacherId: teacherId || null,
      attendanceShift,
    });

    // Generate token
    const token = generateToken(user);

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: {
        id: user.id ?? user._id,
        _id: user.id ?? user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        departmentId: user.departmentId,
        departmentIds: user.departmentIds,
        teacherId: user.teacherId,
        attendanceShift: user.attendanceShift,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Login User
const loginUser = async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    const loginIdentifier = phone || email;

    // Find user
    const user = await User.findOne({
      $or: [{ phone: loginIdentifier }, { email: loginIdentifier }],
    });

    if (!user) {
      return res.status(401).json({
        message: "Invalid phone/email or password",
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid phone/email or password",
      });
    }

    // Generate token
    const token = generateToken(user);

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id ?? user._id,
        _id: user.id ?? user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        departmentId: user.departmentId,
        departmentIds: user.departmentIds || [],
        teacherId: user.teacherId || null,
        attendanceShift: user.attendanceShift,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
};
