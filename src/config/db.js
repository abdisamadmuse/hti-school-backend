const mongoose = require("mongoose");
const dns = require("dns");

const connectDB = async () => {
  try {
    dns.setServers(["1.1.1.1", "8.8.8.8"]);
  } catch (e) {
    // ignore if setting DNS servers isn't allowed in the environment
  }
  
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB Connected Successfully");
  } catch (error) {
    console.error("MongoDB Connection Failed:");
    console.error(error.message);
    process.exit(1);
  }
};

module.exports = connectDB;