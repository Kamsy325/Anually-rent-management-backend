const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const db = new sqlite3.Database(
  path.join(__dirname, "database.sqlite"),
  (err) => {
    if (err) {
      console.error("SQLite connection error:", err.message);
    } else {
      console.log("Connected to SQLite");
    }
  }
);

module.exports = db;