import express from "express";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const STORE_ID = process.env.NUVEMSHOP_STORE_ID;
const ACCESS_TOKEN = process.env.NUVEMSHOP_ACCESS_TOKEN;
const STORE_NAME = process.env.STORE_NAME || "Bobinou Maker Store";
const MARK_FULFILLED = String(process.env.NUVEMSHOP_MARK_FULFILLED || "false").toLowerCase() === "true";
const USER_AGENT = process.env.APP_USER_AGENT || "Bobinou Entregas";

const CITY_CONFIG = {
  ponta_grossa: {
    label: "Ponta Grossa",
    aliases: ["ponta grossa"],
    pin: process.env.DRIVER_PIN_PONTA_GROSSA || "8803"
  },
  guarapuava: {
    label: "Guarapuava",
    aliases: ["guarapuava"],
    pin: process.env.DRIVER_PIN_GUARAPUAVA || "1234"
  }
};

const API_BASE = `https://api.nuvemshop.com.br/v1/${STORE_ID}`;
const DATA_FILE = path.join(__dirname, "data", "delivery-status.json");
const sessions = new Map();

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function readStatuses() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeStatuses(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getSession(req) {
  const sid = req.cookies?.bobinou_session;
  return sid ? sessions.get(sid) : null;
}

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Não autenticado." });
  req.deliverySession = session;
  next();
}

function nuvemHeaders() {
  return {
    Authentication: `bearer ${ACCESS_TOKEN}`,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json"
  };
}

function formatAddress(order) {
  const a = order.shipping_address || {};
  return {
    name: a.name || order.contact_name || "",
    address: a.address || "",
    number: a.number || "",
    floor: a.floor || "",
    locality: a.locality || "",
    city: a.city || "",
    province: a.province || "",
    zipcode: a.zipcode || "",
    phone: a.phone || order.contact_phone || ""
  };
}

function paymentLabel(order) {
  if (order.payment_details?.method) return order.payment_details.method;
  if (order.gateway_name) return order.gateway_name;
  if (order.gateway) return order.gateway;
  return "Não informado";
}

function orderMatchesCity(order, cityKey) {
  const config = CITY_CONFIG[cityKey];
  if (!config) return false;
  const city = normalizeText(formatAddress(order).city);
  return config.aliases.some(alias => city === normalizeText(alias));
}

async function nsFetch(endpoint, options = {}) {
  if (!STORE_ID || !ACCESS_TOKEN) {
    throw new Error("Configure NUVEMSHOP_STORE_ID e NUVEMSHOP_ACCESS_TOKEN no arquivo .env.");
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: { ...nuvemHeaders(), ...(options.headers || {}) }
  });

  const bodyText = await response.text();
  let body;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = bodyText; }

  if (!response.ok) {
    const err = new Error(`Nuvemshop respondeu ${response.status}.`);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

app.post("/api/login", (req, res) => {
  const pin = String(req.body?.pin || "");
  const cityKey = String(req.body?.city || "");
  const city = CITY_CONFIG[cityKey];

  if (!city) return res.status(400).json({ error: "Selecione uma cidade válida." });
  if (pin !== city.pin) return res.status(401).json({ error: "PIN incorreto para esta cidade." });

  const sid = crypto.randomBytes(24).toString("hex");
  sessions.set(sid, { createdAt: Date.now(), cityKey, cityLabel: city.label });

  res.cookie("bobinou_session", sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 12
  });

  res.json({ ok: true, storeName: STORE_NAME, city: city.label });
});

app.post("/api/logout", requireAuth, (req, res) => {
  const sid = req.cookies?.bobinou_session;
  if (sid) sessions.delete(sid);
  res.clearCookie("bobinou_session");
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({
    authenticated: true,
    storeName: STORE_NAME,
    city: req.deliverySession.cityLabel,
    cityKey: req.deliverySession.cityKey
  });
});

app.get("/api/orders", requireAuth, async (req, res) => {
  try {
    const orders = await nsFetch("/orders?status=open&per_page=50");
    const statuses = readStatuses();
    const cityKey = req.deliverySession.cityKey;

    const normalized = (orders || [])
      .filter(order => orderMatchesCity(order, cityKey))
      .map(order => {
        const localStatus = statuses[String(order.id)] || {
          status: "aguardando",
          updatedAt: null,
          note: ""
        };

        return {
          id: order.id,
          number: order.number,
          createdAt: order.created_at || order.completed_at,
          customer: order.contact_name || formatAddress(order).name || "Cliente",
          phone: order.contact_phone || formatAddress(order).phone || "",
          address: formatAddress(order),
          total: order.total || order.total_with_shipping || "0.00",
          currency: order.currency || "BRL",
          paymentStatus: order.payment_status || "",
          paymentMethod: paymentLabel(order),
          shippingOption: order.shipping_option || "",
          fulfillmentStatus: order.fulfillment_status || order.fulfillment || "",
          products: (order.products || []).map(p => ({
            name: p.name || p.product_name || "Produto",
            quantity: p.quantity || 1,
            price: p.price || ""
          })),
          delivery: localStatus
        };
      });

    res.json(normalized);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({
      error: err.message || "Erro ao consultar pedidos.",
      details: err.body || null
    });
  }
});

app.patch("/api/orders/:id/delivery", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const status = String(req.body?.status || "");
  const note = String(req.body?.note || "").slice(0, 500);
  const allowed = ["aguardando", "saiu", "entregue", "problema"];

  if (!allowed.includes(status)) return res.status(400).json({ error: "Status inválido." });

  try {
    const order = await nsFetch(`/orders/${id}`);
    if (!orderMatchesCity(order, req.deliverySession.cityKey)) {
      return res.status(403).json({ error: "Este pedido pertence a outra cidade." });
    }
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || "Não foi possível validar o pedido." });
  }

  const statuses = readStatuses();
  statuses[id] = {
    status,
    note,
    city: req.deliverySession.cityLabel,
    updatedAt: new Date().toISOString()
  };
  writeStatuses(statuses);

  if (status === "entregue" && MARK_FULFILLED) {
    try {
      await nsFetch(`/orders/${id}/fulfill`, {
        method: "POST",
        body: JSON.stringify({ notify_customer: true })
      });
    } catch (err) {
      return res.status(502).json({
        error: "O painel registrou como entregue, mas a Nuvemshop não aceitou o fulfillment.",
        delivery: statuses[id],
        details: err.body || err.message
      });
    }
  }

  res.json({ ok: true, delivery: statuses[id] });
});

app.get("/api/orders/:id", requireAuth, async (req, res) => {
  try {
    const order = await nsFetch(`/orders/${req.params.id}`);
    if (!orderMatchesCity(order, req.deliverySession.cityKey)) {
      return res.status(403).json({ error: "Este pedido pertence a outra cidade." });
    }
    res.json(order);
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message || "Erro ao consultar pedido.",
      details: err.body || null
    });
  }
});

app.listen(PORT, () => {
  console.log(`Bobinou Entregas rodando em http://localhost:${PORT}`);
});
