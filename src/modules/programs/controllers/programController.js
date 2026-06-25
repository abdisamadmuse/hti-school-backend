const Program = require("../models/Program");

exports.createProgram = async (req, res) => {
  try {
    const program = await Program.create(req.body);

    res.status(201).json({
      message: "Program created successfully",
      data: program,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getPrograms = async (req, res) => {
  try {
    const programs = await Program.find().sort({ createdAt: -1 });

    res.status(200).json({
      count: programs.length,
      data: programs,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getProgramById = async (req, res) => {
  try {
    const program = await Program.findById(req.params.id);

    if (!program) {
      return res.status(404).json({ message: "Program not found" });
    }

    res.status(200).json({ data: program });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateProgram = async (req, res) => {
  try {
    const program = await Program.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!program) {
      return res.status(404).json({ message: "Program not found" });
    }

    res.status(200).json({
      message: "Program updated successfully",
      data: program,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteProgram = async (req, res) => {
  try {
    const program = await Program.findByIdAndDelete(req.params.id);

    if (!program) {
      return res.status(404).json({ message: "Program not found" });
    }

    res.status(200).json({
      message: "Program deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
