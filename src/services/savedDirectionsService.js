import { api } from "./dataService";

export const index = () => api.get("/saved-directions", { auth: true });

export const create = (payload) => api.post("/saved-directions", payload, { auth: true });

export const update = (id, payload) => api.put(`/saved-directions/${id}`, payload, { auth: true });

export const remove = (id) => api.del(`/saved-directions/${id}`, { auth: true });
