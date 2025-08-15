(() => {
  // ==========================
  // CONFIG
  const FREE_THRESHOLD = 70000;
  const FALLBACK_SHIPPING = 4500;
  const ORIGIN_CP = "1757";
  const CURRENCY = "ARS";
  const PROXY_RATES_URL = "https://proxy-correo.onrender.com"; 

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function parseMoneyFromNode(node) {
    if (!node) return 0;
    const txt = (node.textContent || "").replace(/\s/g,"");
    const cleaned = txt.replace(/[^0-9,.\-]/g,"");
    const num = cleaned.includes(",") && cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? parseFloat(cleaned.replace(/\./g,"").replace(",","."))
      : parseFloat(cleaned.replace(/,/g,""));
    return isNaN(num) ? 0 : num;
  }

  function formatARS(n) {
    try {
      return new Intl.NumberFormat('es-AR', { style: 'currency', currency: CURRENCY }).format(n);
    } catch {
      return `$ ${n.toFixed(2)}`;
    }
  }

  function getOdooCartTotal() {
    const candidates = [
      ".js_cart_summary .oe_currency_value",
      ".o_total .oe_currency_value",
      "span.oe_currency_value"
    ];
    for (const sel of candidates) {
      const node = $(sel);
      const val = parseMoneyFromNode(node);
      if (val > 0) return val;
    }
    return 0;
  }

  function isValidCPA(value) {
    const v = (value || "").trim().toUpperCase();
    const reCPA = /^[A-Z]\d{4}[A-Z]{3}$/;
    const reCP4 = /^\d{4}$/;
    return reCPA.test(v) || reCP4.test(v);
  }

  async function fetchRateViaProxy(destCP, deliveredType) {
    if (!PROXY_RATES_URL) return null;
    try {
      const payload = {
        postalCodeOrigin: ORIGIN_CP,
        postalCodeDestination: destCP,
        deliveredType,
        dimensions: { weight: 1000, height: 10, width: 10, length: 10 }
      };
      const res = await fetch(PROXY_RATES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("Bad response");
      const data = await res.json();
      const price = Number(data?.price);
      return isNaN(price) ? null : price;
    } catch (e) {
      console.warn("Proxy rates error:", e);
      return null;
    }
  }

  function ensureWidget() {
    if ($("#shipping-widget")) return $("#shipping-widget");

    const mountPoint = $(".js_cart_summary") || $(".o_payment_summary") || $("main");
    if (!mountPoint) return null;

    const wrap = document.createElement("section");
    wrap.id = "shipping-widget";
    wrap.style.border = "1px solid #e5e7eb";
    wrap.style.borderRadius = "12px";
    wrap.style.padding = "16px";
    wrap.style.margin = "16px 0";
    wrap.style.boxShadow = "0 2px 10px rgba(0,0,0,0.05)";
    wrap.innerHTML = `
      <h3 style="margin:0 0 8px;font-size:18px;">Envío / Retiro</h3>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:6px;">
          <input type="radio" name="ship_method" value="pickup" checked>
          Retiro en depósito del vendedor (sin cargo)
        </label>
        <label style="display:flex;align-items:center;gap:6px;">
          <input type="radio" name="ship_method" value="home">
          Envío por Correo Argentino
        </label>
      </div>

      <div id="cp-row" style="margin-top:12px; display:none;">
        <label style="display:block;margin-bottom:6px;">Código Postal (CPA o 4 dígitos)</label>
        <input id="cp-input" type="text" placeholder="Ej: B1842ZAB o 1704" style="padding:8px;border:1px solid #d1d5db;border-radius:8px;width:220px;">
        <span id="cp-msg" style="margin-left:8px;font-size:13px;color:#6b7280;"></span>
        <div style="margin-top:8px;">
          <label style="display:flex;align-items:center;gap:6px;">
            <input type="radio" name="delivery_type" value="D" checked> A domicilio
          </label>
          <label style="display:flex;align-items:center;gap:6px;">
            <input type="radio" name="delivery_type" value="S"> A sucursal
          </label>
        </div>
      </div>

      <hr style="margin:12px 0;">
      <div id="totals" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
        <div><strong>Subtotal:</strong> <span id="t-subtotal">—</span></div>
        <div><strong>Envío:</strong> <span id="t-shipping">—</span></div>
        <div><strong>Total:</strong> <span id="t-total">—</span></div>
        <div id="free-badge" style="display:none;padding:4px 8px;background:#ecfdf5;border:1px solid #10b981;color:#065f46;border-radius:999px;font-size:12px;">
          ¡Envío gratis aplicado!
        </div>
      </div>
    `;
    mountPoint.prepend(wrap);
    return wrap;
  }

  let currentSubtotal = 0;
  let currentShipping = 0;

  async function recalc() {
    currentSubtotal = getOdooCartTotal();
    const widget = ensureWidget();
    if (!widget) return;

    const method = (document.querySelector('input[name="ship_method"]:checked') || {}).value || "pickup";
    const destCP = ($("#cp-input")?.value || "").trim().toUpperCase();
    const deliveredType = (document.querySelector('input[name="delivery_type"]:checked') || {}).value || "D";

    const tSub = $("#t-subtotal");
    const tShip = $("#t-shipping");
    const tTot = $("#t-total");
    const freeBadge = $("#free-badge");
    const cpRow = $("#cp-row");
    const cpMsg = $("#cp-msg");

    cpRow.style.display = method === "home" ? "block" : "none";

    let shipping = 0;
    let cpOk = true;

    if (method === "home") {
      if (!isValidCPA(destCP)) {
        cpOk = false;
        cpMsg.textContent = "Formato inválido. Ingresá CPA (A9999AAA) o 4 dígitos.";
        cpMsg.style.color = "#b91c1c";
      } else {
        cpMsg.textContent = "Formato OK.";
        cpMsg.style.color = "#065f46";
      }

      if (currentSubtotal >= FREE_THRESHOLD) {
        shipping = 0;
      } else if (cpOk) {
        const real = await fetchRateViaProxy(destCP, deliveredType);
        shipping = (real == null) ? FALLBACK_SHIPPING : real;
      } else {
        shipping = 0;
      }
    } else {
      shipping = 0;
    }

    currentShipping = shipping;
    const total = currentSubtotal + currentShipping;

    tSub.textContent = formatARS(currentSubtotal);
    tShip.textContent = method === "home"
      ? (cpOk ? formatARS(currentShipping) : "—")
      : formatARS(0);
    tTot.textContent = cpOk ? formatARS(total) : formatARS(currentSubtotal);

    freeBadge.style.display = (method === "home" && currentSubtotal >= FREE_THRESHOLD) ? "inline-block" : "none";
  }

  function bind() {
    document.addEventListener("input", (e) => {
      const id = e.target?.id;
      const name = e.target?.name;
      if (id === "cp-input" || name === "ship_method" || name === "delivery_type") {
        recalc();
      }
    });

    const obs = new MutationObserver(() => recalc());
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });

    ensureWidget();
    recalc();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();

// ✅ Exponer la función globalmente
window.insertarWidgetEnvioCorreo = function() {
  const widget = document.getElementById("shipping-widget");
  if (!widget) {
    // Si el widget no existe, lo crea y recalcula
    const mount = document.querySelector(".js_cart_summary") || document.querySelector("main");
    if (mount) {
      const evt = new Event("DOMContentLoaded");
      document.dispatchEvent(evt);
    }
  } else {
    // Si ya existe, solo recalcula
    const recalcEvent = new Event("input");
    document.dispatchEvent(recalcEvent);
  }
};


