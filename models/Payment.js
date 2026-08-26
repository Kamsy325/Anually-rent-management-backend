const db = require("./database");

// =====================================================
// CREATE PAYMENTS TABLE
// =====================================================

db.run(
  `
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      tenant_id INTEGER NOT NULL,

      landlord_id INTEGER NOT NULL,

      amount REAL NOT NULL,

      due_date TEXT NOT NULL,

      paid_date TEXT,

      status TEXT NOT NULL DEFAULT 'pending',

      payment_method TEXT,

      paystack_reference TEXT,

      paystack_transaction_id TEXT,

      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE CASCADE,

      FOREIGN KEY (landlord_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

      UNIQUE (
        tenant_id,
        due_date
      )
    )
  `,
  (err) => {
    if (err) {
      console.error(
        "Error creating payments table:",
        err
      );
    } else {
      console.log(
        "Payments table ready"
      );

      migratePaymentColumns();
    }
  }
);


// =====================================================
// ADD MISSING PAYMENT COLUMNS
// =====================================================

function addPaymentColumn(
  columnName,
  columnType
) {
  return new Promise(
    (resolve) => {

      db.run(
        `
          ALTER TABLE payments
          ADD COLUMN ${columnName} ${columnType}
        `,
        (err) => {

          if (!err) {

            console.log(
              `Added payments.${columnName}`
            );

            resolve();
            return;
          }


          if (
            String(
              err.message
            ).toLowerCase()
              .includes(
                "duplicate column name"
              )
          ) {

            console.log(
              `payments.${columnName} already exists`
            );

            resolve();
            return;
          }


          console.error(
            `Error adding payments.${columnName}:`,
            err.message
          );

          resolve();
        }
      );

    }
  );
}


async function migratePaymentColumns() {

  try {

    await addPaymentColumn(
      "paystack_reference",
      "TEXT"
    );

    await addPaymentColumn(
      "paystack_transaction_id",
      "TEXT"
    );

    console.log(
      "Payment table migration complete"
    );

  } catch (error) {

    console.error(
      "PAYMENT MIGRATION ERROR:",
      error
    );

  }

}


// =====================================================
// DATE HELPERS
// =====================================================

function toDateString(date) {

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


function parseDate(value) {

  if (!value) {
    return null;
  }


  const match =
    String(value).match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );


  if (match) {

    const year =
      Number(match[1]);

    const month =
      Number(match[2]) - 1;

    const day =
      Number(match[3]);

    const date =
      new Date(
        year,
        month,
        day
      );


    if (
      date.getFullYear() === year &&
      date.getMonth() === month &&
      date.getDate() === day
    ) {

      return date;

    }

    return null;
  }


  const date =
    new Date(value);


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return null;
  }


  date.setHours(
    0,
    0,
    0,
    0
  );


  return date;
}


// =====================================================
// GET TODAY
// =====================================================

function getToday() {

  const today =
    new Date();

  today.setHours(
    0,
    0,
    0,
    0
  );

  return today;
}


// =====================================================
// ADD MONTH
// =====================================================

function addMonth(date) {

  const result =
    new Date(date);

  const originalDay =
    result.getDate();


  result.setDate(1);


  result.setMonth(
    result.getMonth() + 1
  );


  const lastDayOfMonth =
    new Date(
      result.getFullYear(),
      result.getMonth() + 1,
      0
    ).getDate();


  result.setDate(
    Math.min(
      originalDay,
      lastDayOfMonth
    )
  );


  return result;
}


// =====================================================
// ADD YEAR
// =====================================================

function addYear(date) {

  const result =
    new Date(date);

  const month =
    result.getMonth();

  const day =
    result.getDate();


  result.setDate(1);


  result.setFullYear(
    result.getFullYear() + 1
  );


  result.setMonth(
    month
  );


  const lastDayOfMonth =
    new Date(
      result.getFullYear(),
      month + 1,
      0
    ).getDate();


  result.setDate(
    Math.min(
      day,
      lastDayOfMonth
    )
  );


  return result;
}


// =====================================================
// GET NEXT DUE DATE
// =====================================================

function getNextDueDate(
  currentDate,
  leaseInterval
) {

  const interval =
    String(
      leaseInterval ||
      "monthly"
    ).toLowerCase();


  if (
    interval === "annual" ||
    interval === "yearly"
  ) {

    return addYear(
      currentDate
    );

  }


  return addMonth(
    currentDate
  );
}


// =====================================================
// GET PAYMENTS BY TENANT
// =====================================================

function getPaymentsByTenant(
  tenantId
) {

  return new Promise(
    (resolve, reject) => {

      db.all(
        `
          SELECT *
          FROM payments

          WHERE tenant_id = ?

          ORDER BY
            due_date DESC
        `,
        [tenantId],
        (err, payments) => {

          if (err) {

            reject(err);
            return;

          }


          resolve(
            payments
          );

        }
      );

    }
  );
}


// =====================================================
// CREATE PAYMENT
// =====================================================

function createPayment({
  tenantId,
  landlordId,
  amount,
  dueDate
}) {

  return new Promise(
    (resolve, reject) => {

      db.run(
        `
          INSERT OR IGNORE INTO payments (

            tenant_id,

            landlord_id,

            amount,

            due_date,

            status

          )

          VALUES (
            ?,
            ?,
            ?,
            ?,
            'pending'
          )
        `,
        [
          tenantId,
          landlordId,
          amount,
          dueDate
        ],
        function (err) {

          if (err) {

            reject(err);
            return;

          }


          if (
            this.changes === 0
          ) {

            resolve(null);
            return;

          }


          const payment = {

            id:
              this.lastID,

            tenant_id:
              tenantId,

            landlord_id:
              landlordId,

            amount,

            due_date:
              dueDate,

            status:
              "pending",

          };


          console.log(
            "PAYMENT CREATED:",
            payment
          );


          resolve(
            payment
          );

        }
      );

    }
  );
}


// =====================================================
// GENERATE TENANT PAYMENTS
//
// IMPORTANT:
//
// FUTURE PAYMENTS ARE NO LONGER CREATED IN ADVANCE.
//
// Example:
//
// lease_ends = 2026-08-26
//
// On 2026-08-26:
//
//   2026-08-26 -> created
//   2026-09-26 -> NOT created
//
// On 2026-09-26:
//
//   2026-09-26 -> created
//   2026-10-26 -> NOT created
//
// This prevents the landlord dashboard from showing
// September immediately after August is paid.
// =====================================================

async function generateTenantPayments(
  tenant
) {

  if (!tenant) {
    return [];
  }


  const leaseEnd =
    parseDate(
      tenant.lease_ends ||
      tenant.leaseEnds
    );


  if (!leaseEnd) {

    console.log(
      "PAYMENT GENERATION: No valid lease date:",
      tenant.lease_ends ||
      tenant.leaseEnds
    );

    return [];

  }


  const amount =
    Number(
      tenant.rent
    );


  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {

    console.log(
      "PAYMENT GENERATION: Invalid rent:",
      tenant.rent
    );

    return [];

  }


  const interval =
    String(
      tenant.lease_interval ||
      tenant.leaseInterval ||
      "monthly"
    ).toLowerCase();


  const today =
    getToday();


  // ===================================================
  // GET EXISTING PAYMENTS
  // ===================================================

  const existingPayments =
    await getPaymentsByTenant(
      tenant.id
    );


  console.log(
    "ENSURE CURRENT PAYMENT:",
    {
      tenantId:
        tenant.id,

      tenant:
        tenant.name,

      existingPayments:
        existingPayments.length,

      today:
        toDateString(
          today
        ),
    }
  );


  // ===================================================
  // DETERMINE PAYMENT DUE DATE
  //
  // We start from the lease date and move forward
  // until we reach the current payment period.
  //
  // We NEVER create a date after today.
  // ===================================================

  let dueDate =
    new Date(
      leaseEnd
    );


  let safetyCounter = 0;


  while (
    dueDate.getTime() <
      today.getTime() &&
    safetyCounter < 120
  ) {

    const nextDate =
      getNextDueDate(
        dueDate,
        interval
      );


    // -------------------------------------------------
    // Stop if the next payment is in the future.
    // -------------------------------------------------

    if (
      nextDate.getTime() >
        today.getTime()
    ) {

      break;

    }


    dueDate =
      nextDate;


    safetyCounter++;

  }


  const dueDateString =
    toDateString(
      dueDate
    );


  // ===================================================
  // DO NOT CREATE FUTURE PAYMENT
  // ===================================================

  if (
    dueDate.getTime() >
      today.getTime()
  ) {

    console.log(
      "NO PAYMENT DUE YET:",
      {
        tenantId:
          tenant.id,

        tenant:
          tenant.name,

        nextDueDate:
          dueDateString,

        today:
          toDateString(
            today
          ),

        message:
          "Next payment is in the future. Nothing created.",
      }
    );


    return [];

  }


  // ===================================================
  // CHECK WHETHER THIS PAYMENT ALREADY EXISTS
  // ===================================================

  const existingPayment =
    existingPayments.find(
      payment =>
        String(
          payment.due_date
        ) ===
        dueDateString
    );


  if (
    existingPayment
  ) {

    console.log(
      "CURRENT PAYMENT EXISTS - NO NEW PAYMENT:",
      {
        tenantId:
          tenant.id,

        paymentId:
          existingPayment.id,

        dueDate:
          existingPayment.due_date,

        status:
          existingPayment.status,
      }
    );


    return [];

  }


  // ===================================================
  // CREATE ONLY THE CURRENT PAYMENT
  // ===================================================

  console.log(
    "CREATING CURRENT PAYMENT:",
    {
      tenantId:
        tenant.id,

      tenant:
        tenant.name,

      amount,

      dueDate:
        dueDateString,

      interval,

      today:
        toDateString(
          today
        ),
    }
  );


  const payment =
    await createPayment({

      tenantId:
        tenant.id,

      landlordId:
        tenant.landlord_id,

      amount,

      dueDate:
        dueDateString,

    });


  return payment
    ? [payment]
    : [];
}


// =====================================================
// UPDATE PAYMENT STATUSES
//
// A payment becomes overdue only after it is more than
// 7 days past its due date.
//
// PAID PAYMENTS ARE NEVER CHANGED.
// =====================================================

function updatePaymentStatuses() {

  return new Promise(
    (resolve, reject) => {

      const today =
        getToday();


      const overdueDate =
        new Date(
          today
        );


      overdueDate.setDate(
        overdueDate.getDate() - 7
      );


      const overdueDateString =
        toDateString(
          overdueDate
        );


      db.run(
        `
          UPDATE payments

          SET status = 'overdue'

          WHERE status = 'pending'

          AND due_date < ?
        `,
        [overdueDateString],
        function (err) {

          if (err) {

            reject(err);
            return;

          }


          console.log(
            "PAYMENT STATUS UPDATE:",
            {
              today:
                toDateString(
                  today
                ),

              overdueBefore:
                overdueDateString,

              changed:
                this.changes,
            }
          );


          resolve({

            changes:
              this.changes,

          });

        }
      );

    }
  );
}


// =====================================================
// GET LANDLORD PAYMENTS
// =====================================================

function getPaymentsByLandlord(
  landlordId
) {

  return new Promise(
    (resolve, reject) => {

      db.all(
        `
          SELECT

            payments.*,

            tenants.name
              AS tenant_name,

            tenants.email
              AS tenant_email,

            tenants.apartment
              AS apartment

          FROM payments

          INNER JOIN tenants

            ON tenants.id =
              payments.tenant_id

          WHERE payments.landlord_id = ?

          ORDER BY
            payments.due_date ASC
        `,
        [landlordId],
        (err, payments) => {

          if (err) {

            reject(err);
            return;

          }


          resolve(
            payments
          );

        }
      );

    }
  );
}


// =====================================================
// UPCOMING PAYMENTS
//
// Only payments already present in the database are
// returned.
//
// Since future payments are no longer generated early,
// September will not appear here before September.
// =====================================================

function getUpcomingPayments(
  landlordId
) {

  return new Promise(
    (resolve, reject) => {

      const today =
        getToday();


      const futureDate =
        new Date(
          today
        );


      futureDate.setDate(
        futureDate.getDate() + 30
      );


      db.all(
        `
          SELECT

            payments.*,

            tenants.name
              AS tenant_name,

            tenants.email
              AS tenant_email,

            tenants.apartment
              AS apartment

          FROM payments

          INNER JOIN tenants

            ON tenants.id =
              payments.tenant_id

          WHERE payments.landlord_id = ?

          AND payments.status = 'pending'

          AND payments.due_date > ?

          AND payments.due_date <= ?

          ORDER BY
            payments.due_date ASC
        `,
        [
          landlordId,

          toDateString(
            today
          ),

          toDateString(
            futureDate
          )
        ],
        (err, payments) => {

          if (err) {

            reject(err);
            return;

          }


          resolve(
            payments
          );

        }
      );

    }
  );
}


// =====================================================
// PENDING PAYMENTS
// =====================================================

function getPendingPayments(
  landlordId
) {

  return new Promise(
    (resolve, reject) => {

      db.all(
        `
          SELECT

            payments.*,

            tenants.name
              AS tenant_name,

            tenants.email
              AS tenant_email,

            tenants.apartment
              AS apartment

          FROM payments

          INNER JOIN tenants

            ON tenants.id =
              payments.tenant_id

          WHERE payments.landlord_id = ?

          AND payments.status = 'pending'

          ORDER BY
            payments.due_date ASC
        `,
        [landlordId],
        (err, payments) => {

          if (err) {

            reject(err);
            return;

          }


          resolve(
            payments
          );

        }
      );

    }
  );
}


// =====================================================
// OVERDUE PAYMENTS
// =====================================================

function getOverduePayments(
  landlordId
) {

  return new Promise(
    (resolve, reject) => {

      db.all(
        `
          SELECT

            payments.*,

            tenants.name
              AS tenant_name,

            tenants.email
              AS tenant_email,

            tenants.apartment
              AS apartment

          FROM payments

          INNER JOIN tenants

            ON tenants.id =
              payments.tenant_id

          WHERE payments.landlord_id = ?

          AND payments.status = 'overdue'

          ORDER BY
            payments.due_date ASC
        `,
        [landlordId],
        (err, payments) => {

          if (err) {

            reject(err);
            return;

          }


          resolve(
            payments
          );

        }
      );

    }
  );
}


// =====================================================
// LAST 5 PAID PAYMENTS
// =====================================================

function getRecentPaidPayments(
  landlordId
) {

  return new Promise(
    (resolve, reject) => {

      db.all(
        `
          SELECT

            payments.*,

            tenants.name
              AS tenant_name,

            tenants.email
              AS tenant_email,

            tenants.apartment
              AS apartment

          FROM payments

          INNER JOIN tenants

            ON tenants.id =
              payments.tenant_id

          WHERE payments.landlord_id = ?

          AND payments.status = 'paid'

          ORDER BY
            payments.paid_date DESC

          LIMIT 5
        `,
        [landlordId],
        (err, payments) => {

          if (err) {

            reject(err);
            return;

          }


          resolve(
            payments
          );

        }
      );

    }
  );
}


// =====================================================
// GET PAYMENT BY ID
// =====================================================

function getPaymentById(
  paymentId
) {

  return new Promise(
    (resolve, reject) => {

      db.get(
        `
          SELECT

            payments.*,

            tenants.name
              AS tenant_name,

            tenants.email
              AS tenant_email,

            tenants.apartment
              AS apartment

          FROM payments

          INNER JOIN tenants

            ON tenants.id =
              payments.tenant_id

          WHERE payments.id = ?

          LIMIT 1
        `,
        [paymentId],
        (err, payment) => {

          if (err) {

            reject(err);
            return;

          }


          resolve(
            payment
          );

        }
      );

    }
  );
}


// =====================================================
// GET PAYMENT BY PAYSTACK REFERENCE
// =====================================================

function getPaymentByReference(
  reference
) {

  return new Promise(
    (resolve, reject) => {

      db.get(
        `
          SELECT

            payments.*,

            tenants.name
              AS tenant_name,

            tenants.email
              AS tenant_email,

            tenants.apartment
              AS apartment

          FROM payments

          INNER JOIN tenants

            ON tenants.id =
              payments.tenant_id

          WHERE
            payments.paystack_reference = ?

          LIMIT 1
        `,
        [reference],
        (err, payment) => {

          if (err) {

            reject(err);
            return;

          }


          resolve(
            payment
          );

        }
      );

    }
  );
}


// =====================================================
// SAVE PAYSTACK REFERENCE
// =====================================================

function savePaystackReference(
  paymentId,
  reference
) {

  return new Promise(
    (resolve, reject) => {

      db.run(
        `
          UPDATE payments

          SET
            paystack_reference = ?

          WHERE id = ?
        `,
        [
          reference,
          paymentId
        ],
        function (err) {

          if (err) {

            reject(err);
            return;

          }


          console.log(
            "PAYSTACK REFERENCE SAVED:",
            {
              paymentId,

              reference,

              changes:
                this.changes,
            }
          );


          resolve({

            changes:
              this.changes,

          });

        }
      );

    }
  );
}


// =====================================================
// MARK PAYMENT AS PAID
//
// Used after successful Paystack verification.
// =====================================================

function markPaymentAsPaid({
  paymentId,
  reference,
  transactionId,
  paymentMethod = "paystack"
}) {

  return new Promise(
    (resolve, reject) => {

      const paidDate =
        new Date().toISOString();


      db.run(
        `
          UPDATE payments

          SET

            status = 'paid',

            paid_date = ?,

            paystack_reference = ?,

            paystack_transaction_id = ?,

            payment_method = ?

          WHERE id = ?

          AND status != 'paid'
        `,
        [
          paidDate,

          reference,

          transactionId,

          paymentMethod,

          paymentId
        ],
        function (err) {

          if (err) {

            reject(err);
            return;

          }


          console.log(
            "MARK PAYMENT AS PAID:",
            {
              paymentId,

              reference,

              transactionId,

              changes:
                this.changes,
            }
          );


          if (
            this.changes === 0
          ) {

            resolve({

              changes:
                0,

            });

            return;

          }


          db.get(
            `
              SELECT *
              FROM payments

              WHERE id = ?
            `,
            [paymentId],
            (selectError, payment) => {

              if (selectError) {

                reject(
                  selectError
                );

                return;

              }


              resolve(
                payment
              );

            }
          );

        }
      );

    }
  );
}


// =====================================================
// EXPORTS
// =====================================================

module.exports = {

  createPayment,

  generateTenantPayments,

  updatePaymentStatuses,

  getPaymentsByTenant,

  getPaymentsByLandlord,

  getUpcomingPayments,

  getPendingPayments,

  getOverduePayments,

  getRecentPaidPayments,

  getNextDueDate,

  getPaymentByReference,

  getPaymentById,

  savePaystackReference,

  markPaymentAsPaid,

};