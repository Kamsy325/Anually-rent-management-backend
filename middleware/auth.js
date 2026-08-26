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

    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
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