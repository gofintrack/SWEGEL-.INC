const mongoose = require("mongoose");

const storeProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: "", trim: true },
    priceIdr: { type: Number, required: true, min: 1, default: 500000 },
    category: { type: String, enum: ["tools", "script", "other"], default: "tools" },
    coverImage: { type: String, default: "", trim: true },
    downloadUrl: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("StoreProduct", storeProductSchema);
