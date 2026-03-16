import { safeJson } from "./utils.js";

export const api = {
  /** GET request that parses JSON. Throws on non-2xx with server error message. */
  async get(path) {
    const res = await fetch(path, {
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) throw new Error(data?.error || `${res.status}`);
    return data || { ok: true };
  },

  /** POST request with JSON body. Throws on non-2xx with server error message. */
  async post(path, payload) {
    const res = await fetch(path, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) throw new Error(data?.error || `${res.status}`);
    return data || { ok: true };
  },
};
