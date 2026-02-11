import { getToken } from "./tokenService";

const BASE = import.meta.env.VITE_BACK_END_SERVER_URL;

async function request(path, { method = "GET", body, auth = false } = {}) {
  const url = `${BASE}${path.startsWith("/") ? path : `/${path}`}`;

  const headers = {};
  if (body != null) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // allow non-json
  }

  if (!res.ok) {
    throw new Error(data?.err || `Request failed (${res.status})`);
  }
  if (data?.err) throw new Error(data.err);

  return data;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: "GET" }),
  post: (path, body, opts) => request(path, { ...opts, method: "POST", body }),
  put: (path, body, opts) => request(path, { ...opts, method: "PUT", body }),
  del: (path, opts) => request(path, { ...opts, method: "DELETE" }),
};
