const jwt = require("jsonwebtoken");

const User = require("../modules/users/models/User");

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({
        message: "Not authorized, token missing",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (!user || !user.isActive) {
      return res.status(401).json({
        message: "Not authorized",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({
      message: "Not authorized, token invalid",
    });
  }
};

const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      message: "Not authorized",
    });
  }

  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      message: "You do not have permission to perform this action",
    });
  }

  next();
};

const examManagerOnly = authorize("SuperAdmin", "ExamManager");

module.exports = {
  protect,
  authorize,
  examManagerOnly,
};
