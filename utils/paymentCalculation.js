// =====================================================
// PAYMENT CALCULATION
// =====================================================

const DAY_MS =
  24 * 60 * 60 * 1000;


// =====================================================
// NORMALIZE DATE
// =====================================================

function normalizeDate(date) {

  const result =
    new Date(date);

  result.setHours(
    0,
    0,
    0,
    0
  );

  return result;
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

  const lastDay =
    new Date(
      result.getFullYear(),
      result.getMonth() + 1,
      0
    ).getDate();

  result.setDate(
    Math.min(
      originalDay,
      lastDay
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

  result.setMonth(month);

  const lastDay =
    new Date(
      result.getFullYear(),
      month + 1,
      0
    ).getDate();

  result.setDate(
    Math.min(
      day,
      lastDay
    )
  );

  return result;
}


// =====================================================
// GET INTERVAL FUNCTION
// =====================================================

function getIntervalFunction(
  leaseInterval
) {

  const interval =
    String(
      leaseInterval || "monthly"
    ).toLowerCase();

  if (
    interval === "annual" ||
    interval === "annually" ||
    interval === "yearly"
  ) {

    return addYear;

  }

  return addMonth;
}


// =====================================================
// GET CURRENT PAYMENT DUE DATE
// =====================================================

function getCurrentPaymentDueDate(
  leaseEnds,
  leaseInterval,
  today = new Date()
) {

  if (!leaseEnds) {
    return null;
  }

  const currentDate =
    normalizeDate(today);

  let paymentDate =
    normalizeDate(leaseEnds);

  const addInterval =
    getIntervalFunction(
      leaseInterval
    );


  while (true) {

    const nextPaymentDate =
      addInterval(
        paymentDate
      );

    if (
      nextPaymentDate >
      currentDate
    ) {

      break;

    }

    paymentDate =
      nextPaymentDate;

  }


  return paymentDate;
}


// =====================================================
// GET NEXT PAYMENT DATE
// =====================================================

function getNextPaymentDate(
  leaseEnds,
  leaseInterval,
  today = new Date()
) {

  if (!leaseEnds) {
    return null;
  }

  const currentDate =
    normalizeDate(today);

  let paymentDate =
    normalizeDate(leaseEnds);

  const addInterval =
    getIntervalFunction(
      leaseInterval
    );


  while (
    paymentDate <
    currentDate
  ) {

    paymentDate =
      addInterval(
        paymentDate
      );

  }


  return paymentDate;
}


// =====================================================
// GET DAYS DIFFERENCE
// =====================================================

function getDaysDifference(
  fromDate,
  toDate
) {

  const from =
    normalizeDate(fromDate);

  const to =
    normalizeDate(toDate);

  return Math.floor(
    (
      to.getTime() -
      from.getTime()
    ) / DAY_MS
  );
}


// =====================================================
// FORMAT DATE
// =====================================================

function formatDate(date) {

  if (!date) {
    return "Not specified";
  }

  return new Intl.DateTimeFormat(
    "en-US",
    {
      month: "long",
      day: "numeric",
      year: "numeric"
    }
  ).format(
    normalizeDate(date)
  );

}


// =====================================================
// GET PAYMENT STATUS
// =====================================================

function getPaymentStatus(
  dueDate,
  payment = null,
  today = new Date()
) {

  /*
   * A real database payment always
   * takes priority.
   */

  if (payment) {

    if (payment.status) {

      return String(
        payment.status
      ).toLowerCase();

    }

  }


  const daysUntilDue =
    getDaysDifference(
      today,
      dueDate
    );


  if (
    daysUntilDue > 0
  ) {

    return "upcoming";

  }


  if (
    daysUntilDue === 0
  ) {

    return "pending";

  }


  const daysOverdue =
    Math.abs(
      daysUntilDue
    );


  if (
    daysOverdue >= 7
  ) {

    return "overdue";

  }


  return "pending";
}


// =====================================================
// CALCULATE TENANT PAYMENT
// =====================================================

function calculateTenantPayment(
  tenant,
  payment = null,
  today = new Date()
) {

  let dueDate;


  /*
   * If this is a real payment record,
   * use its database due date.
   */

  if (
    payment &&
    payment.due_date
  ) {

    dueDate =
      normalizeDate(
        payment.due_date
      );

  } else {

    dueDate =
      getCurrentPaymentDueDate(
        tenant.lease_ends,
        tenant.lease_interval,
        today
      );

  }


  if (!dueDate) {

    return {

      id:
        payment?.id || null,

      tenantId:
        tenant.id,

      tenant:
        tenant.name,

      apartment:
        tenant.apartment,

      amount:
        Number(
          payment?.amount ??
          tenant.rent ??
          0
        ),

      dueDate:
        null,

      dueDateText:
        "Not specified",

      status:
        payment?.status ||
        "upcoming",

      daysUntilDue:
        null,

      leaseInterval:
        tenant.lease_interval

    };

  }


  const daysUntilDue =
    getDaysDifference(
      today,
      dueDate
    );


  const status =
    getPaymentStatus(
      dueDate,
      payment,
      today
    );


  return {

    /*
     * IMPORTANT:
     * This is the real payments.id.
     */

    id:
      payment?.id || null,

    tenantId:
      tenant.id,

    tenant:
      tenant.name,

    apartment:
      tenant.apartment,

    amount:
      Number(
        payment?.amount ??
        tenant.rent ??
        0
      ),

    dueDate:
      dueDate
        .toISOString()
        .split("T")[0],

    dueDateText:
      formatDate(
        dueDate
      ),

    status,

    daysUntilDue,

    leaseInterval:
      tenant.lease_interval,

    paymentMethod:
      payment?.payment_method ||
      null,

    paidDate:
      payment?.paid_date ||
      null

  };

}


// =====================================================
// CALCULATE ALL TENANT PAYMENTS
// =====================================================

function calculateTenantPayments(
  tenants,
  payments = [],
  today = new Date()
) {

  const results = [];


  for (
    const tenant of tenants
  ) {

    const tenantPayments =
      payments.filter(
        (payment) =>
          Number(
            payment.tenant_id
          ) ===
          Number(
            tenant.id
          )
      );


    /*
     * If payment records already exist,
     * use the actual database records.
     */

    if (
      tenantPayments.length > 0
    ) {

      tenantPayments.forEach(
        (payment) => {

          results.push(
            calculateTenantPayment(
              tenant,
              payment,
              today
            )
          );

        }
      );


      continue;

    }


    /*
     * No payment record exists yet.
     * Calculate the current obligation.
     */

    results.push(
      calculateTenantPayment(
        tenant,
        null,
        today
      )
    );

  }


  return results;

}


// =====================================================
// GET CURRENT PAYABLE PAYMENT
//
// Only ONE payment is returned.
//
// Future payments stay in the database,
// but they are not currently payable.
// =====================================================

function getCurrentPayablePayment(
  calculatedPayments
) {

  if (
    !Array.isArray(
      calculatedPayments
    )
  ) {

    return null;

  }


  const unpaid =
    calculatedPayments
      .filter(
        (payment) =>
          (
            payment.status ===
            "pending"
          ) ||
          (
            payment.status ===
            "overdue"
          )
      )
      .sort(
        (a, b) => {

          const dateA =
            new Date(
              a.dueDate
            ).getTime();

          const dateB =
            new Date(
              b.dueDate
            ).getTime();

          return (
            dateA -
            dateB
          );

        }
      );


  return (
    unpaid[0] ||
    null
  );

}


// =====================================================
// PENDING PAYMENTS
// =====================================================

function getPendingPayments(
  calculatedPayments
) {

  const current =
    getCurrentPayablePayment(
      calculatedPayments
    );


  if (
    !current
  ) {

    return [];

  }


  if (
    current.status !==
    "pending"
  ) {

    return [];

  }


  return [
    current
  ];

}


// =====================================================
// OVERDUE PAYMENTS
// =====================================================

function getOverduePayments(
  calculatedPayments
) {

  const current =
    getCurrentPayablePayment(
      calculatedPayments
    );


  if (
    !current
  ) {

    return [];

  }


  if (
    current.status !==
    "overdue"
  ) {

    return [];

  }


  return [
    current
  ];

}


// =====================================================
// UPCOMING DEADLINES
//
// Future payments are allowed here.
// =====================================================

function getUpcomingDeadlines(
  calculatedPayments,
  days = 30
) {

  return calculatedPayments

    .filter(
      (payment) =>
        payment.dueDate &&

        payment.status ===
          "upcoming" &&

        payment.daysUntilDue >
          0 &&

        payment.daysUntilDue <=
          days
    )

    .sort(
      (a, b) =>
        a.daysUntilDue -
        b.daysUntilDue
    );

}


// =====================================================
// EXPORTS
// =====================================================

module.exports = {

  addMonth,

  addYear,

  getNextPaymentDate,

  getCurrentPaymentDueDate,

  getDaysDifference,

  formatDate,

  getPaymentStatus,

  calculateTenantPayment,

  calculateTenantPayments,

  getCurrentPayablePayment,

  getUpcomingDeadlines,

  getPendingPayments,

  getOverduePayments

};