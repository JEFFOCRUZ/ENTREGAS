const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const loginScreen = $("#login");
const appScreen = $("#app");
const ordersEl = $("#orders");
const loadingEl = $("#loading");
const errorBox = $("#errorBox");
let orders = [];
let currentFilter = "pendentes";
let currentCity = "";

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Erro");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function money(value, currency = "BRL") {
  const n = Number(value || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency || "BRL"
  }).format(n);
}

function addrText(a = {}) {
  const first = [a.address, a.number].filter(Boolean).join(", ");
  const second = [a.floor, a.locality].filter(Boolean).join(" - ");
  const third = [a.city, a.province].filter(Boolean).join(" / ");
  return [first, second, third, a.zipcode].filter(Boolean).join(" • ");
}

function mapsUrl(a) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addrText(a))}`;
}

function whatsappUrl(phone, orderNumber) {
  const digits = String(phone || "").replace(/\D/g, "");
  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  const text = `Olá! Sou da entrega da Bobinou. Estou com o pedido #${orderNumber}.`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

function statusLabel(status) {
  return {
    aguardando: "AGUARDANDO",
    saiu: "EM ROTA",
    entregue: "ENTREGUE",
    problema: "PROBLEMA"
  }[status] || "AGUARDANDO";
}

function renderStats() {
  $("#countWaiting").textContent = orders.filter(o => o.delivery.status === "aguardando").length;
  $("#countOnRoute").textContent = orders.filter(o => o.delivery.status === "saiu").length;
  $("#countDone").textContent = orders.filter(o => o.delivery.status === "entregue").length;
}

function filteredOrders() {
  if (currentFilter === "todos") return orders;
  if (currentFilter === "pendentes") return orders.filter(o => ["aguardando", "saiu"].includes(o.delivery.status));
  return orders.filter(o => o.delivery.status === currentFilter);
}

function renderOrders() {
  ordersEl.innerHTML = "";
  renderStats();

  const list = filteredOrders();
  if (!list.length) {
    ordersEl.innerHTML = `<div class="notice">Nenhuma entrega nesta categoria.</div>`;
    return;
  }

  for (const order of list) {
    const frag = $("#orderTemplate").content.cloneNode(true);
    const card = frag.querySelector(".order-card");
    frag.querySelector(".order-number").textContent = `PEDIDO #${order.number}`;
    frag.querySelector(".customer").textContent = order.customer;
    frag.querySelector(".address").textContent = addrText(order.address) || "Endereço não informado";
    frag.querySelector(".phone").textContent = order.phone || "Não informado";
    frag.querySelector(".payment").textContent =
      `${order.paymentMethod}${order.paymentStatus ? " • " + order.paymentStatus : ""}`;
    frag.querySelector(".total").textContent = money(order.total, order.currency);

    const badge = frag.querySelector(".status-badge");
    badge.textContent = statusLabel(order.delivery.status);
    badge.classList.add(order.delivery.status);

    const products = frag.querySelector(".products");
    products.innerHTML = (order.products || []).map(p =>
      `<div class="product"><strong>${p.quantity}x</strong> ${escapeHtml(p.name)}</div>`
    ).join("");

    const map = frag.querySelector(".map-link");
    map.href = mapsUrl(order.address);

    const whats = frag.querySelector(".whatsapp-link");
    if (order.phone) whats.href = whatsappUrl(order.phone, order.number);
    else {
      whats.removeAttribute("href");
      whats.style.opacity = ".5";
    }

    const note = frag.querySelector(".note");
    note.value = order.delivery.note || "";

    for (const btn of frag.querySelectorAll(".action")) {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const data = await api(`/api/orders/${order.id}/delivery`, {
            method: "PATCH",
            body: JSON.stringify({
              status: btn.dataset.status,
              note: note.value
            })
          });
          order.delivery = data.delivery;
          renderOrders();
        } catch (e) {
          alert(e.message);
        } finally {
          btn.disabled = false;
        }
      });
    }

    ordersEl.appendChild(card);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

async function loadOrders() {
  loadingEl.classList.remove("hidden");
  errorBox.classList.add("hidden");
  try {
    orders = await api("/api/orders");
    renderOrders();
  } catch (e) {
    errorBox.textContent = e.data?.details
      ? `${e.message} ${JSON.stringify(e.data.details)}`
      : e.message;
    errorBox.classList.remove("hidden");
  } finally {
    loadingEl.classList.add("hidden");
  }
}

function setCityUI(city) {
  currentCity = city || "";
  $("#cityLabel").textContent = currentCity;
  $("#cityBanner").textContent = currentCity;
}

async function boot() {
  try {
    const me = await api("/api/me");
    setCityUI(me.city);
    loginScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    await loadOrders();
  } catch {}
}

$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("#loginError").textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ pin: $("#pin").value, city: $("#city").value })
    });
    const me = await api("/api/me");
    setCityUI(me.city);
    loginScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    await loadOrders();
  } catch (e) {
    $("#loginError").textContent = e.message;
  }
});

$("#refreshBtn").addEventListener("click", loadOrders);
$("#logoutBtn").addEventListener("click", async () => {
  await api("/api/logout", { method:"POST" }).catch(()=>{});
  location.reload();
});

for (const btn of $$(".filter")) {
  btn.addEventListener("click", () => {
    $$(".filter").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderOrders();
  });
}

boot();
