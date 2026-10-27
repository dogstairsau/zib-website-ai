import { guard } from "../lib/rateLimit";
import { handleUpgrade } from "../lib/websiteUpgrade";
export const config = { runtime: "edge" };
export default function handler(req: Request): Promise<Response> {
  return handleUpgrade(req, guard);
}
