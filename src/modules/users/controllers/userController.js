const bcrypt = require("bcryptjs");
const User = require("../models/User");

const normalizeDepartmentIds = ({ departmentId, departmentIds }) => {
  if (Array.isArray(departmentIds)) {
    return departmentIds.filter(Boolean);
  }

  return departmentId ? [departmentId] : [];
};

const getAttendanceShift = (data) =>
  data.attendanceShift ||
  data.attendance_shift ||
  data.attendanceShiftId ||
  data.attendance_shiftId ||
  data.attendance_shift_id ||
  data.shift;

const populateUserDepartments = (query) =>
  query.populate("departmentId").populate("departmentIds");

// Get all users
exports.getUsers = async (req, res) => {
  try {
    const users = await populateUserDepartments(
      User.find().select("-password").sort({ createdAt: -1 })
    );

    res.status(200).json({
      count: users.length,
      data: users,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get single user
exports.getUserById = async (req, res) => {
  try {
    const user = await populateUserDepartments(
      User.findById(req.params.id).select("-password")
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ data: user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create user by admin
exports.createUser = async (req, res) => {
  try {
    const {
      fullName,
      email,
      phone,
      password,
      role,
      departmentId,
      departmentIds,
    } = req.body;
    const attendanceShift = getAttendanceShift(req.body);

    const exists = await User.findOne({
      $or: [{ email }, { phone }],
    });

    if (exists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const normalizedDepartmentIds = normalizeDepartmentIds({
      departmentId,
      departmentIds,
    });

    const user = await User.create({
      fullName,
      email,
      phone,
      password: hashedPassword,
      role,
      departmentId: departmentId || normalizedDepartmentIds[0] || null,
      departmentIds: normalizedDepartmentIds,
      attendanceShift,
    });

    res.status(201).json({
      message: "User created successfully",
      data: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        departmentId: user.departmentId,
        departmentIds: user.departmentIds,
        attendanceShift: user.attendanceShift,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update user
exports.updateUser = async (req, res) => {
  try {
    const { password, ...updateData } = req.body;
    const attendanceShift = getAttendanceShift(updateData);

    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    if (attendanceShift) {
      updateData.attendanceShift = attendanceShift;
    }

    if (
      Object.prototype.hasOwnProperty.call(updateData, "departmentId") ||
      Object.prototype.hasOwnProperty.call(updateData, "departmentIds")
    ) {
      const normalizedDepartmentIds = normalizeDepartmentIds(updateData);
      updateData.departmentIds = normalizedDepartmentIds;
      updateData.departmentId =
        updateData.departmentId || normalizedDepartmentIds[0] || null;
    }

    const user = await populateUserDepartments(
      User.findByIdAndUpdate(req.params.id, updateData, {
        new: true,
        runValidators: true,
      }).select("-password")
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "User updated successfully",
      data: user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete user permanently
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "User deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Disable user
exports.disableUser = async (req, res) => {
  try {
    const user = await populateUserDepartments(
      User.findByIdAndUpdate(
        req.params.id,
        { isActive: false },
        { new: true }
      ).select("-password")
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "User disabled successfully",
      data: user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Enable user
exports.enableUser = async (req, res) => {
  try {
    const user = await populateUserDepartments(
      User.findByIdAndUpdate(
        req.params.id,
        { isActive: true },
        { new: true }
      ).select("-password")
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "User enabled successfully",
      data: user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
