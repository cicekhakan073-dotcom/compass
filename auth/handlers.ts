// Tiny re-export so the route file imports only the handler surface
// instead of pulling the full auth() helper bundle into the edge runtime.
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
