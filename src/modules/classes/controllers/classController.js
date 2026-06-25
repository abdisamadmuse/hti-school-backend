const Class = require("../models/Class");

// CREATE CLASS
exports.createClass = async (req, res) => {
  try {
    const newClass = await Class.create(req.body);

    res.status(201).json(newClass);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// GET ALL CLASSES
exports.getClasses = async (req, res) => {
  try {
    const classes = await Class.find()
      .populate("programId")
      .populate("departmentId")
      .populate("academicYearId")
      .sort({ createdAt: -1 });

    res.json(classes);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// GET SINGLE CLASS
exports.getClassById = async (req, res) => {
  try {
    const singleClass = await Class.findById(req.params.id)
      .populate("programId")
      .populate("departmentId")
      .populate("academicYearId");

    if (!singleClass) {
      return res.status(404).json({
        message: "Class not found",
      });
    }

    res.json(singleClass);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// UPDATE CLASS
exports.updateClass = async (req, res) => {
  try {
    const updatedClass = await Class.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!updatedClass) {
      return res.status(404).json({
        message: "Class not found",
      });
    }

    res.json(updatedClass);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// DELETE CLASS
exports.deleteClass = async (req, res) => {
  try {
    const deletedClass = await Class.findByIdAndDelete(req.params.id);

    if (!deletedClass) {
      return res.status(404).json({
        message: "Class not found",
      });
    }

    res.json({
      message: "Class deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
