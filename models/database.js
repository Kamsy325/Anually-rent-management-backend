const { createClient } = require("@libsql/client");
const path = require("path");

// Ensure environment variables are loaded
require("dotenv").config();

const DEFAULT_TURSO_URL =
  process.env.TURSO_DATABASE_URL ||
  "libsql://anually-kamsy325.aws-eu-west-1.turso.io";

let clientInstance = null;
let activeConfigKey = null;
let isFallbackActive = false;

function isAuthError(err) {
  if (!err) return false;
  const msg = (err.message || "").toLowerCase();
  const causeStatus = err.cause && err.cause.status;
  return (
    causeStatus === 401 ||
    causeStatus === 400 ||
    causeStatus === 403 ||
    err.status === 401 ||
    err.status === 400 ||
    err.status === 403 ||
    msg.includes("401") ||
    msg.includes("400") ||
    msg.includes("403") ||
    msg.includes("unauthorized") ||
    msg.includes("jwt") ||
    msg.includes("fetch failed") ||
    msg.includes("enotfound") ||
    msg.includes("econnrefused")
  );
}

function activateFallback(reason) {
  if (isFallbackActive) return;
  isFallbackActive = true;
  console.error(
    `\n======================================================\n` +
    `[Turso] CRITICAL AUTH ERROR (HTTP 401 Unauthorized)\n` +
    `[Turso] Reason: ${reason}\n` +
    `[Turso] The TURSO_AUTH_TOKEN configured in your environment is invalid, expired, or rejected by Turso.\n` +
    `[Turso] To fix permanently:\n` +
    `        1. Run: turso db tokens create anually-kamsy325\n` +
    `        2. Update TURSO_AUTH_TOKEN in your Render.com dashboard (Environment tab)\n` +
    `[Turso] Temporarily falling back to local SQLite database so your server stays online.\n` +
    `======================================================\n`
  );
  try {
    if (clientInstance) clientInstance.close();
  } catch (e) {}
  activeConfigKey = "local-sqlite-fallback";
  clientInstance = createClient({
    url: `file:${path.join(__dirname, "database.sqlite")}`,
  });
}

/**
 * Returns the active LibSQL / Turso client instance.
 * Automatically falls back to local SQLite if remote URL is set but TURSO_AUTH_TOKEN is missing.
 */
function getClient() {
  if (isFallbackActive) {
    if (!clientInstance) {
      clientInstance = createClient({
        url: `file:${path.join(__dirname, "database.sqlite")}`,
      });
    }
    return clientInstance;
  }

  const rawUrl = process.env.TURSO_DATABASE_URL || DEFAULT_TURSO_URL;
  const url = rawUrl ? rawUrl.trim().replace(/^["']|["']$/g, "") : "";
  let authToken = process.env.TURSO_AUTH_TOKEN
    ? process.env.TURSO_AUTH_TOKEN.trim().replace(/^["']|["']$/g, "")
    : "";

  if (authToken === "undefined" || authToken === "null") {
    authToken = "";
  }

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
    return getClient()
      .execute(sqlOrConfig)
      .catch((err) => {
        if (isAuthError(err) && !isFallbackActive) {
          activateFallback(err.message || "HTTP status 401");
          return getClient().execute(sqlOrConfig);
        }
        throw err;
      });
  },

  batch(statements, mode) {
    return getClient()
      .batch(statements, mode)
      .catch((err) => {
        if (isAuthError(err) && !isFallbackActive) {
          activateFallback(err.message || "HTTP status 401");
          return getClient().batch(statements, mode);
        }
        throw err;
      });
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
        if (isAuthError(err) && !isFallbackActive) {
          activateFallback(err.message || "HTTP status 401");
          return db.run(sql, actualParams, actualCallback);
        }

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
        if (isAuthError(err) && !isFallbackActive) {
          activateFallback(err.message || "HTTP status 401");
          return db.get(sql, actualParams, actualCallback);
        }

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
        if (isAuthError(err) && !isFallbackActive) {
          activateFallback(err.message || "HTTP status 401");
          return db.all(sql, actualParams, actualCallback);
        }

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
        if (isAuthError(err) && !isFallbackActive) {
          activateFallback(err.message || "HTTP status 401");
          return db.exec(sql, callback);
        }

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
