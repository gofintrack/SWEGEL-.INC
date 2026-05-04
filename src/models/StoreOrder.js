const mongoose = require("mongoose");

const storeOrderSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "StoreProduct", required: true },
    productName: { type: String, required: true },
    buyerEmail: { type: String, required: true, lowercase: true, trim: true },
    amountIdr: { type: Number, required: true },
    paymentMethod: { type: String, enum: ["bank", "usdt"], default: "bank" },
    usdtAmount: { type: Number, default: null },
    idrPerUsdt: { type: Number, default: null },
    rateSource: { type: String, default: null },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    invoiceCode: { type: String, required: true, unique: true },
    downloadToken: { type: String, default: null, unique: true, sparse: true },
    downloadIssuedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    telegramMessageId: { type: Number, default: null },
    reviewedBy: { type: String, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("StoreOrder", storeOrderSchema);
