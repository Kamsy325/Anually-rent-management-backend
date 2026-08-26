const axios =
  require("axios");


const PAYSTACK_BASE_URL =
  "https://api.paystack.co";


const paystack =
  axios.create({

    baseURL:
      PAYSTACK_BASE_URL,

    headers: {

      Authorization:
        `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

      "Content-Type":
        "application/json",

    },

  });


// =====================================================
// GET BANKS
// =====================================================

async function getBanks() {

  const response =
    await paystack.get(
      "/bank",
      {
        params: {

          country:
            "nigeria",

          currency:
            "NGN",

        },
      }
    );


  return response.data.data;

}


// =====================================================
// CREATE SUBACCOUNT
// =====================================================

async function createSubaccount({

  businessName,

  bankCode,

  accountNumber,

}) {

  const response =
    await paystack.post(
      "/subaccount",
      {

        business_name:
          businessName,

        bank_code:
          bankCode,

        account_number:
          accountNumber,

        percentage_charge:
          0,

      }
    );


  return response.data.data;

}


// =====================================================
// GET SUBACCOUNT
// =====================================================

async function getSubaccount(
  subaccountCode
) {

  const response =
    await paystack.get(
      `/subaccount/${subaccountCode}`
    );


  return response.data.data;

}


// =====================================================
// UPDATE SUBACCOUNT
// =====================================================

async function updateSubaccount(
  subaccountCode,
  data
) {

  const response =
    await paystack.put(
      `/subaccount/${subaccountCode}`,
      data
    );


  return response.data.data;

}


// =====================================================
// INITIALIZE TRANSACTION
// =====================================================
//
// Amount is received in major currency units
// from our application.
//
// Paystack expects the amount in the smallest
// currency unit.
//
// Example:
//
// $700 -> 70000
//
// =====================================================

async function initializeTransaction({

  email,

  amount,

  reference,

  subaccountCode,

  callbackUrl,

}) {

  const amountInSmallestUnit =
    Math.round(
      Number(amount) * 100
    );


  if (
    !Number.isFinite(
      amountInSmallestUnit
    ) ||
    amountInSmallestUnit <= 0
  ) {

    throw new Error(
      "Invalid payment amount"
    );

  }


  const payload = {

    email,

    amount:
      amountInSmallestUnit,

    reference,

  };


  if (subaccountCode) {

    payload.subaccount =
      subaccountCode;

  }


  if (callbackUrl) {

    payload.callback_url =
      callbackUrl;

  }


  const response =
    await paystack.post(
      "/transaction/initialize",
      payload
    );


  return response.data.data;

}


// =====================================================
// VERIFY TRANSACTION
// =====================================================

async function verifyTransaction(
  reference
) {

  const response =
    await paystack.get(
      `/transaction/verify/${encodeURIComponent(
        reference
      )}`
    );


  return response.data.data;

}


module.exports = {

  getBanks,

  createSubaccount,

  getSubaccount,

  updateSubaccount,

  initializeTransaction,

  verifyTransaction,

};