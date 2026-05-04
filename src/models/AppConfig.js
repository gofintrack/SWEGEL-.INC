const mongoose = require("mongoose");

const appConfigSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, required: true },
    masterKeyHash: { type: String, required: false },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.model("AppConfig", appConfigSchema);
