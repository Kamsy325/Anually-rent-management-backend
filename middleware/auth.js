const jwt = require("jsonwebtoken");


function authenticateToken(
  req,
  res,
  next
) {

  const authHeader =
    req.headers.authorization;


  const token =
    authHeader &&
    authHeader.split(" ")[1];


  if (!token) {

    return res.status(401).json({

      message:
        "Authentication required"

    });

  }


  try {

    const jwtSecret =
      process.env.JWT_SECRET ||
      "your_jwt_secret";

    const decoded =
      jwt.verify(
        token,
        jwtSecret
      );


    console.log(
      "AUTHENTICATED USER:",
      decoded
    );


    req.user =
      decoded;


    next();

  } catch (error) {

    console.error(
      "AUTH TOKEN ERROR:",
      error
    );


    return res.status(401).json({

      message:
        "Invalid or expired token"

    });

  }

}


module.exports =
  authenticateToken;