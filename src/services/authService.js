import { api } from "./dataService";
import { setToken, getUserFromToken } from "./tokenService";

async function authRequest(path, formData) {
  const data = await api.post(`/auth/${path}`, formData);

  if (!data?.token) throw new Error("Invalid response from server");
  setToken(data.token);

  return getUserFromToken(data.token);
}

export const signUp = (formData) => authRequest("sign-up", formData);
export const signIn = (formData) => authRequest("sign-in", formData);
