import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createKiroUsageSource } from "./server/kiro";
import { createAntigravityUsageSource } from "./server/antigravity";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource(createKiroUsageSource());
  server.registerUsageSource(createAntigravityUsageSource());
  return () => {};
}
