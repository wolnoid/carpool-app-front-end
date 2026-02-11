const TOKEN_KEY = "token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function base64UrlDecode(str) {
  // base64url -> base64
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 ? "=".repeat(4 - (base64.length % 4)) : "";
  return atob(base64 + pad);
}

export function getUserFromToken(token = getToken()) {
  if (!token) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(token.split(".")[1]));
    return payload?.payload ?? null;
  } catch {
    return null;
  }
}
