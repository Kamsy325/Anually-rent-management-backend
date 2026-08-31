// services/paystack.js
const axios = require("axios");

const PAYSTACK_BASE_URL = "https://api.paystack.co";

const paystack = axios.create({
  baseURL: PAYSTACK_BASE_URL,
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
});

async function getBanks() {
  const response = await paystack.get("/bank", {
    params: { country: "nigeria", currency: "NGN" },
  });
  return response.data.data;
}

async function createSubaccount({ businessName, bankCode, accountNumber }) {
  const response = await paystack.post("/subaccount", {
    business_name: businessName,
    bank_code: bankCode,
    account_number: accountNumber,
    percentage_charge: 0,
  });
  return response.data.data;
}

// Subscription initialization (landlord paying platform)
async function initializeSubscription({ email, amount, reference, callbackUrl }) {
  const amountInKobo = Math.round(Number(amount) * 100);

  const payload = {
    email,
    amount: amountInKobo,
    currency: "NGN",
    reference,
    callback_url: callbackUrl,
  };

  const response = await paystack.post("/transaction/initialize", payload);
  return response.data.data;
}

// Rent initialization with platform fee percentage split
async function initializeRentPayment({
  email,
  amount,
  reference,
  subaccountCode,
  platformFeePercent,
  callbackUrl,
}) {
  const amountInKobo = Math.round(Number(amount) * 100);

  const payload = {
    email,
    amount: amountInKobo,
    currency: "NGN",
    reference,
    subaccount: subaccountCode,
    bearer: "subaccount",
  };

  if (platformFeePercent > 0) {
    payload.percentage_charge = platformFeePercent;
  }

  if (callbackUrl) {
    payload.callback_url = callbackUrl;
  }

  const response = await paystack.post("/transaction/initialize", payload);
  return response.data.data;
}

async function verifyTransaction(reference) {
  const response = await paystack.get(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );
  return response.data.data;
}

module.exports = {
  getBanks,
  createSubaccount,
  initializeSubscription,
  initializeRentPayment,
  verifyTransaction,
};