function requireLandlord(req, res, next) {

  if (!req.user) {
    return res.status(401).json({
      message: "Not authenticated"
    });
  }

  if (req.user.role !== "landlord") {
    return res.status(403).json({
      message: "Landlord access required"
    });
  }

  next();
}

module.exports = requireLandlord;