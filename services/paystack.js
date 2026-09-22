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

async function getSubaccount(subaccountCode) {
  const response = await paystack.get(`/subaccount/${encodeURIComponent(subaccountCode)}`);
  return response.data.data;
}

async function initializeRentPayment({
  email,
  amount,
  reference,
  subaccountCode,
  platformFeePercent = 3.0,
  callbackUrl,
}) {
  const amountInKobo = Math.round(Number(amount) * 100);

  const payload = {
    email,
    amount: amountInKobo,
    currency: "NGN",
    reference,
    subaccount: subaccountCode,
    // Landlord bears both Paystack processing fee and platform transaction fee
    bearer: "subaccount",
    percentage_charge: Number(platformFeePercent || 3.0),
  };

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
  getSubaccount,
  initializeRentPayment,
  verifyTransaction,
};
