const { createClient } = require("@libsql/client");
const path = require("path");

// Ensure environment variables are loaded
require("dotenv").config();

const DEFAULT_TURSO_URL =
  process.env.TURSO_DATABASE_URL ||
  "libsql://anually-kamsy325.aws-eu-west-1.turso.io";

let clientInstance = null;
let activeConfigKey = null;

/**
 * Returns the active LibSQL / Turso client instance.
 * Automatically falls back to local SQLite if remote URL is set but TURSO_AUTH_TOKEN is missing.
 */
function getClient() {
  const url = process.env.TURSO_DATABASE_URL || DEFAULT_TURSO_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN
    ? process.env.TURSO_AUTH_TOKEN.trim()
    : "";
  const configKey = `${url}:::${authToken}`;

  if (!clientInstance || activeConfigKey !== configKey) {
    activeConfigKey = configKey;

    const isRemote =
      url.startsWith("libsql://") ||
      url.startsWith("https://") ||
      url.startsWith("http://");

    if (isRemote && !authToken) {
      console.warn(
        `[Turso] Remote URL configured (${url}) but TURSO_AUTH_TOKEN is not set.` +
          `\n[Turso] Falling back to local SQLite (database.sqlite) until TURSO_AUTH_TOKEN is provided in environment variables.`
      );
      clientInstance = createClient({
        url: `file:${path.join(__dirname, "database.sqlite")}`,
      });
    } else {
      console.log(`[Turso] Connected to database: ${url}`);
      clientInstance = createClient({
        url,
        authToken: authToken || undefined,
      });
    }
  }

  return clientInstance;
}

/**
 * Normalizes query parameters:
 * Converts undefined values to null to ensure compatibility with @libsql/client.
 */
function normalizeParams(params) {
  if (!params) return [];
  if (Array.isArray(params)) {
    return params.map((p) => (p === undefined ? null : p));
  }
  if (typeof params === "object") {
    const sanitized = {};
    for (const [key, value] of Object.entries(params)) {
      sanitized[key] = value === undefined ? null : value;
    }
    return sanitized;
  }
  return [params === undefined ? null : params];
}

/**
 * SQLite-compatible database adapter backed by Turso (@libsql/client).
 * Fully compatible with existing db.run(), db.get(), db.all(), and db.exec() callback patterns.
 */
const db = {
  get client() {
    return getClient();
  },

  getClient,

  // Promise-based Turso direct execution
  execute(sqlOrConfig) {
    return getClient().execute(sqlOrConfig);
  },

  batch(statements, mode) {
    return getClient().batch(statements, mode);
  },

  // SQLite3 callback-compatible run()
  run(sql, params, callback) {
    let actualParams = [];
    let actualCallback = null;

    if (typeof params === "function") {
      actualCallback = params;
    } else {
      actualParams = normalizeParams(params);
      actualCallback = callback;
    }

    getClient()
      .execute({ sql, args: actualParams })
      .then((res) => {
        if (typeof actualCallback === "function") {
          const context = {
            lastID:
              res.lastInsertRowid !== undefined && res.lastInsertRowid !== null
                ? Number(res.lastInsertRowid)
                : 0,
            changes:
              typeof res.rowsAffected === "number" ? res.rowsAffected : 0,
          };
          actualCallback.call(context, null);
        }
      })
      .catch((err) => {
        if (typeof actualCallback === "function") {
          actualCallback(err);
        } else {
          console.error(
            "[Turso/SQLite] Unhandled error in db.run:",
            err.message || err
          );
        }
      });

    return this;
  },

  // SQLite3 callback-compatible get()
  get(sql, params, callback) {
    let actualParams = [];
    let actualCallback = null;

    if (typeof params === "function") {
      actualCallback = params;
    } else {
      actualParams = normalizeParams(params);
      actualCallback = callback;
    }

    getClient()
      .execute({ sql, args: actualParams })
      .then((res) => {
        if (typeof actualCallback === "function") {
          const row =
            res.rows && res.rows.length > 0 ? res.rows[0] : undefined;
          actualCallback(null, row);
        }
      })
      .catch((err) => {
        if (typeof actualCallback === "function") {
          actualCallback(err, null);
        } else {
          console.error(
            "[Turso/SQLite] Unhandled error in db.get:",
            err.message || err
          );
        }
      });

    return this;
  },

  // SQLite3 callback-compatible all()
  all(sql, params, callback) {
    let actualParams = [];
    let actualCallback = null;

    if (typeof params === "function") {
      actualCallback = params;
    } else {
      actualParams = normalizeParams(params);
      actualCallback = callback;
    }

    getClient()
      .execute({ sql, args: actualParams })
      .then((res) => {
        if (typeof actualCallback === "function") {
          actualCallback(null, res.rows || []);
        }
      })
      .catch((err) => {
        if (typeof actualCallback === "function") {
          actualCallback(err, []);
        } else {
          console.error(
            "[Turso/SQLite] Unhandled error in db.all:",
            err.message || err
          );
        }
      });

    return this;
  },

  // SQLite3 callback-compatible exec()
  exec(sql, callback) {
    getClient()
      .executeMultiple(sql)
      .then(() => {
        if (typeof callback === "function") {
          callback(null);
        }
      })
      .catch((err) => {
        if (typeof callback === "function") {
          callback(err);
        } else {
          console.error(
            "[Turso/SQLite] Unhandled error in db.exec:",
            err.message || err
          );
        }
      });

    return this;
  },

  close(callback) {
    try {
      if (clientInstance) {
        clientInstance.close();
        clientInstance = null;
        activeConfigKey = null;
      }
      if (typeof callback === "function") callback(null);
    } catch (err) {
      if (typeof callback === "function") callback(err);
    }
  },
};

module.exports = db;
