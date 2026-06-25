const AcademicYear = require("../models/AcademicYear");

// Create Academic Year
exports.createAcademicYear = async (req, res) => {
  try {
    const { name, startDate, endDate, isActive } = req.body;

    const exists = await AcademicYear.findOne({ name });

    if (exists) {
      return res.status(400).json({
        message: "Academic year already exists",
      });
    }

    if (isActive === true) {
      await AcademicYear.updateMany({}, { isActive: false });
    }

    const academicYear = await AcademicYear.create({
      name,
      startDate,
      endDate,
      isActive: isActive || false,
    });

    res.status(201).json({
      message: "Academic year created successfully",
      data: academicYear,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Get All Academic Years
exports.getAcademicYears = async (req, res) => {
  try {
    const academicYears = await AcademicYear.find().sort({ createdAt: -1 });

    res.status(200).json({
      count: academicYears.length,
      data: academicYears,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Get Single Academic Year
exports.getAcademicYearById = async (req, res) => {
  try {
    const academicYear = await AcademicYear.findById(req.params.id);

    if (!academicYear) {
      return res.status(404).json({
        message: "Academic year not found",
      });
    }

    res.status(200).json({
      data: academicYear,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Update Academic Year
exports.updateAcademicYear = async (req, res) => {
  try {
    const { isActive } = req.body;

    if (isActive === true) {
      await AcademicYear.updateMany({}, { isActive: false });
    }

    const academicYear = await AcademicYear.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!academicYear) {
      return res.status(404).json({
        message: "Academic year not found",
      });
    }

    res.status(200).json({
      message: "Academic year updated successfully",
      data: academicYear,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Delete Academic Year
exports.deleteAcademicYear = async (req, res) => {
  try {
    const academicYear = await AcademicYear.findByIdAndDelete(req.params.id);

    if (!academicYear) {
      return res.status(404).json({
        message: "Academic year not found",
      });
    }

    res.status(200).json({
      message: "Academic year deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Activate Academic Year
exports.activateAcademicYear = async (req, res) => {
  try {
    const academicYear = await AcademicYear.findById(req.params.id);

    if (!academicYear) {
      return res.status(404).json({
        message: "Academic year not found",
      });
    }

    await AcademicYear.updateMany({}, { isActive: false });

    academicYear.isActive = true;
    await academicYear.save();

    res.status(200).json({
      message: "Academic year activated successfully",
      data: academicYear,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
