require("dotenv").config();

const crypto = require("crypto");
const path = require("path");

const bcrypt = require("bcryptjs");
const express = require("express");
const session = require("express-session");
const connectMongo = require("connect-mongo");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");

const AppConfig = require("./src/models/AppConfig");
const Product = require("./src/models/Product");
const StoreProduct = require("./src/models/StoreProduct");
const StoreOrder = require("./src/models/StoreOrder");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/landing_auth_db";
const SESSION_SECRET = process.env.SESSION_SECRET || "replace-this-session-secret";
const STORE_TELEGRAM_BOT_TOKEN = process.env.STORE_TELEGRAM_BOT_TOKEN || "";
const STORE_TELEGRAM_ADMIN_CHAT_ID = process.env.STORE_TELEGRAM_ADMIN_CHAT_ID || "";
const STORE_BASE_URL = process.env.STORE_BASE_URL || "";
const MongoStore = connectMongo.default || connectMongo.MongoStore || connectMongo;

const defaultProducts = [
  { name: "Sender", category: "tools", url: "https://example.com/sender", isDefault: true },
  { name: "Shortlink", category: "tools", url: "https://example.com/shortlink", isDefault: true },
  { name: "Validator", category: "tools", url: "https://example.com/validator", isDefault: true },
  { name: "Xfinity", category: "script", url: "https://example.com/xfinity", isDefault: true },
  { name: "Chase", category: "script", url: "https://example.com/chase", isDefault: true },
  { name: "TopperPay", category: "script", url: "https://example.com/topperpay", isDefault: true }
];

const defaultStoreProducts = [
  {
    name: "SweGeL Sender Ultimate",
    slug: "swegel-sender-ultimate",
    description: "Full sender package with panel, monitoring, and premium support.",
    priceIdr: 500000,
    category: "tools",
    coverImage: "",
    downloadUrl: "https://example.com/download/sender-ultimate",
    isActive: true
  }
];

function requireMasterAccess(req, res, next) {
  if (req.session.masterAccessGranted) return next();
  return res.redirect("/setup-key");
}

async function ensureMasterKey() {
  let config = await AppConfig.findOne({ key: "global_master_access" });
  if (!config) {
    config = new AppConfig({ key: "global_master_access" });
  }

  if (!config.masterKeyHash) {
    const generatedKey = crypto.randomBytes(24).toString("hex");
    const keyHash = await bcrypt.hash(generatedKey, 12);
    config.masterKeyHash = keyHash;
    await config.save();
    console.log("====================================================");
    console.log("MASTER KEY (hanya tampil 1x saat pertama startup):");
    console.log(generatedKey);
    console.log("Simpan key ini dengan aman.");
    console.log("====================================================");
  } else {
    await config.save();
  }
}

async function ensureDefaultProducts() {
  const ops = defaultProducts.map((item) => ({
    updateOne: {
      filter: { name: item.name, category: item.category, isDefault: true },
      update: { $setOnInsert: item },
      upsert: true
    }
  }));

  if (ops.length > 0) {
    await Product.bulkWrite(ops);
  }
}

async function ensureDefaultStoreProducts() {
  for (const item of defaultStoreProducts) {
    const exists = await StoreProduct.findOne({ slug: item.slug }).lean();
    if (!exists) {
      await StoreProduct.create(item);
    }
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeDomainInput(input) {
  return String(input || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function genInvoiceCode() {
  return `INV-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

async function getUsdtQuoteFromIdr(amountIdr) {
  const fallbackRate = Number(process.env.FALLBACK_IDR_PER_USDT || 16000);
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr");
    const json = await response.json();
    const idrPerUsdt = Number(json?.tether?.idr);
    if (!Number.isFinite(idrPerUsdt) || idrPerUsdt <= 0) throw new Error("Invalid quote");
    const usdtAmount = Number((Number(amountIdr) / idrPerUsdt).toFixed(2));
    return { usdtAmount, idrPerUsdt, rateSource: "coingecko" };
  } catch {
    const usdtAmount = Number((Number(amountIdr) / fallbackRate).toFixed(2));
    return { usdtAmount, idrPerUsdt: fallbackRate, rateSource: "fallback" };
  }
}

async function callTelegramStore(method, payload) {
  if (!STORE_TELEGRAM_BOT_TOKEN) return null;
  const response = await fetch(`https://api.telegram.org/bot${STORE_TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  const json = await response.json();
  if (!json.ok) throw new Error(json.description || "Telegram API failed");
  return json.result;
}

async function getOrCreateTelegramOffsetConfig() {
  let cfg = await AppConfig.findOne({ key: "store_telegram_offset" });
  if (!cfg) {
    cfg = await AppConfig.create({ key: "store_telegram_offset", meta: { offset: 0 } });
  }
  if (!cfg.meta) cfg.meta = { offset: 0 };
  if (!Number.isInteger(cfg.meta.offset)) cfg.meta.offset = 0;
  return cfg;
}

function getStorePublicBase(req) {
  if (STORE_BASE_URL) return STORE_BASE_URL.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.get("host");
  return `${proto}://${host}`;
}

async function notifyStoreOrderToTelegram(order) {
  if (!STORE_TELEGRAM_BOT_TOKEN || !STORE_TELEGRAM_ADMIN_CHAT_ID) return null;
  const text = [
    "STORE PAYMENT REQUEST",
    `Invoice: ${order.invoiceCode}`,
    `Product: ${order.productName}`,
    `Buyer: ${order.buyerEmail}`,
    `Method: ${order.paymentMethod.toUpperCase()}`,
    `Amount: Rp${Number(order.amountIdr).toLocaleString("id-ID")}`,
    order.usdtAmount ? `USDT: ${order.usdtAmount} (TRC20)` : null,
    `Status: ${order.status}`
  ].filter(Boolean).join("\n");

  const reply_markup = {
    inline_keyboard: [[
      { text: "Approve", callback_data: `store_approve:${order._id}` },
      { text: "Reject", callback_data: `store_reject:${order._id}` }
    ]]
  };
  const result = await callTelegramStore("sendMessage", {
    chat_id: STORE_TELEGRAM_ADMIN_CHAT_ID,
    text,
    reply_markup
  });
  return result?.message_id || null;
}

async function processStoreTelegramUpdate(update) {
  const cb = update?.callback_query;
  if (!cb?.data) return;
  const [action, orderId] = String(cb.data).split(":");
  if (!mongoose.Types.ObjectId.isValid(orderId)) return;
  const order = await StoreOrder.findById(orderId);
  if (!order || order.status !== "pending") {
    await callTelegramStore("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: "Order not found/already processed"
    });
    return;
  }
  if (action === "store_approve") {
    order.status = "approved";
    order.approvedAt = new Date();
    order.reviewedBy = cb.from?.username || cb.from?.id || "store-admin";
    order.downloadToken = crypto.randomBytes(24).toString("hex");
    order.downloadIssuedAt = new Date();
    await order.save();
    await callTelegramStore("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: `Approved ${order.invoiceCode}`
    });
    return;
  }
  if (action === "store_reject") {
    order.status = "rejected";
    order.rejectedAt = new Date();
    order.reviewedBy = cb.from?.username || cb.from?.id || "store-admin";
    await order.save();
    await callTelegramStore("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: `Rejected ${order.invoiceCode}`
    });
  }
}

let storeTgPolling = false;
async function pollStoreTelegramUpdates() {
  if (!STORE_TELEGRAM_BOT_TOKEN) return;
  if (storeTgPolling) return;
  storeTgPolling = true;
  try {
    const cfg = await getOrCreateTelegramOffsetConfig();
    const offset = Number(cfg.meta?.offset || 0);
    const updates = await callTelegramStore("getUpdates", {
      offset: offset + 1,
      timeout: 0,
      allowed_updates: ["callback_query"]
    });
    if (Array.isArray(updates) && updates.length) {
      let maxUpdateId = offset;
      for (const upd of updates) {
        if (upd.update_id > maxUpdateId) maxUpdateId = upd.update_id;
        await processStoreTelegramUpdate(upd);
      }
      cfg.meta.offset = maxUpdateId;
      await cfg.save();
    }
  } catch (err) {
    console.error("Store Telegram poll error:", err.message);
  } finally {
    storeTgPolling = false;
  }
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 150,
    standardHeaders: true,
    legacyHeaders: false
  })
);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8
    },
    store: MongoStore.create({
      mongoUrl: MONGO_URI,
      collectionName: "sessions"
    })
  })
);

app.use((req, res, next) => {
  res.locals.masterAccessGranted = Boolean(req.session.masterAccessGranted);
  next();
});

app.get("/", async (req, res) => {
  const products = await Product.find().sort({ category: 1, createdAt: 1 }).lean();
  const tools = products.filter((p) => p.category === "tools");
  const scripts = products.filter((p) => p.category === "script");
  const storeProducts = await StoreProduct.find({ isActive: true }).sort({ createdAt: -1 }).lean();

  res.render("landing", {
    tools,
    scripts,
    storeProducts
  });
});

app.get("/setup-key", async (req, res) => {
  res.render("setup-key", { error: null, success: null });
});

app.post("/setup-key", async (req, res) => {
  const { masterKey } = req.body;
  const config = await AppConfig.findOne({ key: "global_master_access" }).lean();
  if (!config || !config.masterKeyHash) {
    return res.status(500).render("setup-key", {
      error: "Master key belum siap. Restart server dan coba lagi.",
      success: null
    });
  }

  const isMatch = await bcrypt.compare(masterKey || "", config.masterKeyHash);
  if (!isMatch) {
    return res.status(401).render("setup-key", {
      error: "Master key salah.",
      success: null
    });
  }

  req.session.masterAccessGranted = true;
  return res.redirect("/store-panel");
});

app.get("/panel", requireMasterAccess, async (req, res) => {
  return res.redirect("/store-panel");
});

app.get("/store-panel", requireMasterAccess, async (req, res) => {
  const products = await StoreProduct.find().sort({ createdAt: -1 }).lean();
  return res.render("store-dashboard", { products, error: null, success: null });
});

app.post("/store-products", requireMasterAccess, async (req, res) => {
  try {
    const { name, slug, description, priceIdr, category, coverImage, downloadUrl, isActive } = req.body;
    if (!name || !slug || !downloadUrl) {
      const products = await StoreProduct.find().sort({ createdAt: -1 }).lean();
      return res.status(400).render("store-dashboard", { products, error: "Data product tidak lengkap.", success: null });
    }
    await StoreProduct.create({
      name: String(name).trim(),
      slug: String(slug).trim().toLowerCase(),
      description: String(description || "").trim(),
      priceIdr: Number(priceIdr || 500000),
      category: ["tools", "script", "other"].includes(category) ? category : "tools",
      coverImage: String(coverImage || "").trim(),
      downloadUrl: String(downloadUrl).trim(),
      isActive: String(isActive || "off") === "on"
    });
    const products = await StoreProduct.find().sort({ createdAt: -1 }).lean();
    return res.render("store-dashboard", { products, error: null, success: "Store product berhasil ditambahkan." });
  } catch (err) {
    const products = await StoreProduct.find().sort({ createdAt: -1 }).lean();
    return res.status(400).render("store-dashboard", { products, error: err.message, success: null });
  }
});

app.post("/store-products/:id/edit", requireMasterAccess, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const products = await StoreProduct.find().sort({ createdAt: -1 }).lean();
    return res.status(400).render("store-dashboard", { products, error: "ID product tidak valid.", success: null });
  }
  const { name, slug, description, priceIdr, category, coverImage, downloadUrl, isActive } = req.body;
  try {
    await StoreProduct.findByIdAndUpdate(id, {
      $set: {
        name: String(name || "").trim(),
        slug: String(slug || "").trim().toLowerCase(),
        description: String(description || "").trim(),
        priceIdr: Number(priceIdr || 500000),
        category: ["tools", "script", "other"].includes(category) ? category : "tools",
        coverImage: String(coverImage || "").trim(),
        downloadUrl: String(downloadUrl || "").trim(),
        isActive: String(isActive || "off") === "on"
      }
    });
    const products = await StoreProduct.find().sort({ createdAt: -1 }).lean();
    return res.render("store-dashboard", { products, error: null, success: "Store product berhasil diupdate." });
  } catch (err) {
    const products = await StoreProduct.find().sort({ createdAt: -1 }).lean();
    return res.status(400).render("store-dashboard", { products, error: err.message, success: null });
  }
});

app.post("/store-products/:id/delete", requireMasterAccess, async (req, res) => {
  const { id } = req.params;
  if (mongoose.Types.ObjectId.isValid(id)) {
    await StoreProduct.findByIdAndDelete(id);
  }
  const products = await StoreProduct.find().sort({ createdAt: -1 }).lean();
  return res.render("store-dashboard", { products, error: null, success: "Store product berhasil dihapus." });
});

app.post("/api/store/order", async (req, res) => {
  try {
    const productId = String(req.body?.productId || "");
    const buyerEmail = normalizeEmail(req.body?.buyerEmail);
    const paymentMethod = String(req.body?.paymentMethod || "bank").toLowerCase();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ ok: false, message: "Product tidak valid." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      return res.status(400).json({ ok: false, message: "Email buyer tidak valid." });
    }
    if (!["bank", "usdt"].includes(paymentMethod)) {
      return res.status(400).json({ ok: false, message: "Payment method invalid." });
    }
    const product = await StoreProduct.findById(productId).lean();
    if (!product || !product.isActive) {
      return res.status(404).json({ ok: false, message: "Product tidak tersedia." });
    }
    const quote = paymentMethod === "usdt" ? await getUsdtQuoteFromIdr(product.priceIdr) : null;
    const order = await StoreOrder.create({
      productId: product._id,
      productName: product.name,
      buyerEmail,
      amountIdr: product.priceIdr,
      paymentMethod,
      usdtAmount: quote?.usdtAmount || null,
      idrPerUsdt: quote?.idrPerUsdt || null,
      rateSource: quote?.rateSource || null,
      status: "pending",
      invoiceCode: genInvoiceCode()
    });
    const msgId = await notifyStoreOrderToTelegram(order);
    if (msgId) {
      await StoreOrder.findByIdAndUpdate(order._id, { $set: { telegramMessageId: msgId } });
    }
    return res.json({
      ok: true,
      order: {
        id: String(order._id),
        invoiceCode: order.invoiceCode,
        status: order.status,
        amountIdr: order.amountIdr,
        paymentMethod: order.paymentMethod,
        usdtAmount: order.usdtAmount,
        idrPerUsdt: order.idrPerUsdt
      },
      payment: {
        bank: "Blu BCA Digital",
        accountNumber: "005658853460",
        accountName: "Novita",
        usdtNetwork: "TRC20",
        usdtAddress: "TSReaKxV5swr6Fmj6uSzt7wLnnxETMzwED"
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || "Create order failed." });
  }
});

app.get("/api/store/order/:id/status", async (req, res) => {
  const id = String(req.params.id || "");
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, message: "Invalid order." });
  const order = await StoreOrder.findById(id).lean();
  if (!order) return res.status(404).json({ ok: false, message: "Order not found." });
  const base = getStorePublicBase(req);
  const downloadLink = order.status === "approved" && order.downloadToken
    ? `${base}/store/download/${order.downloadToken}`
    : null;
  return res.json({
    ok: true,
    order: {
      id: String(order._id),
      invoiceCode: order.invoiceCode,
      status: order.status,
      downloadLink
    }
  });
});

app.get("/store/download/:token", async (req, res) => {
  const token = String(req.params.token || "");
  if (!token) return res.status(404).send("Invalid token.");
  const order = await StoreOrder.findOne({ downloadToken: token, status: "approved" }).lean();
  if (!order) return res.status(404).send("Download token invalid or expired.");
  const product = await StoreProduct.findById(order.productId).lean();
  if (!product?.downloadUrl) return res.status(404).send("Download not available.");
  return res.redirect(product.downloadUrl);
});

app.post("/logout", (req, res) => {
  req.session.masterAccessGranted = false;
  return res.redirect("/");
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  return res.status(500).send("Terjadi error pada server.");
});

async function start() {
  await mongoose.connect(MONGO_URI);
  await ensureMasterKey();
  await ensureDefaultProducts();
  await ensureDefaultStoreProducts();
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    if (STORE_TELEGRAM_BOT_TOKEN) {
      setInterval(() => {
        pollStoreTelegramUpdates();
      }, 3000);
      console.log("Store Telegram bot polling enabled.");
    }
  });
}

start().catch((err) => {
  console.error("Gagal menjalankan server:", err);
  process.exit(1);
});
