import { api } from "./dataService";

export const index = () => api.get("/users", { auth: true });
