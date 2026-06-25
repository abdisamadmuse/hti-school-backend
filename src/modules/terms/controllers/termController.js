const Term = require("../models/Term");

exports.createTerm = async (req, res) => {
  try {
    const term = await Term.create(req.body);

    res.status(201).json({
      message: "Term created successfully",
      data: term,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getTerms = async (req, res) => {
  try {
    const terms = await Term.find()
      .populate("academicYearId")
      .sort({ createdAt: -1 });

    res.status(200).json({
      count: terms.length,
      data: terms,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getTermById = async (req, res) => {
  try {
    const term = await Term.findById(req.params.id).populate("academicYearId");

    if (!term) {
      return res.status(404).json({ message: "Term not found" });
    }

    res.status(200).json({ data: term });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateTerm = async (req, res) => {
  try {
    const term = await Term.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!term) {
      return res.status(404).json({ message: "Term not found" });
    }

    res.status(200).json({
      message: "Term updated successfully",
      data: term,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteTerm = async (req, res) => {
  try {
    const term = await Term.findByIdAndDelete(req.params.id);

    if (!term) {
      return res.status(404).json({ message: "Term not found" });
    }

    res.status(200).json({
      message: "Term deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
