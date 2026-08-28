const express = require("express");
const cors = require("cors");

require("dotenv").config();

const signup =
  require("./routes/signup.js");

const login =
  require("./routes/login.js");

const getUser =
  require("./routes/getUser.js");

const tenants =
  require("./routes/tenants.js");

const payments = require('./routes/payments.js')
const paymentRoutes = require('./routes/paymentRoute.js')
const dashboard = require('./routes/dashboard.js')
const migrateUsers = require('./models/migrateUsers.js')

const updateProfile = require("./routes/updateProfile.js")

const paystackRoutes = require("./routes/paystack.js")

const notificationRoutes = require("./routes/notificationRoutes");
const { startNotificationScheduler } = require("./services/notificationScheduler");


const app = express();


app.use(express.json());


app.use(cors({
  origin: "http://localhost:5173",
  optionSuccessStatus: 200
}));


app.get("/", (req, res) => {
  res.send("Hello world");
});

migrateUsers()

app.use("/notifications", notificationRoutes);

// Start daily cron job
startNotificationScheduler();

console.log('app.use(payments)')

app.use(payments)

console.log('app.use(dashboard)')
app.use(dashboard)

app.use(signup);

app.use(login);

app.use(getUser);

app.use(tenants);

app.use(updateProfile)

console.log('paystackRoutes')
app.use(paystackRoutes)
app.use('/payments', paymentRoutes)

console.log('paystack')
const PORT =
  process.env.PORT || 5000;


app.listen(
  PORT,
  () => {
    console.log(
      `Server started on port ${PORT}`
    );
  }
);