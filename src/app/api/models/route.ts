import { NextResponse } from "next/server";
import { getKey, getKeyStatuses } from "@/lib/keys";
import { MODELS, PROVIDERS, type ModelOption, type Provider } from "@/lib/models";
import { fetchOpenCodeModels, type OpenCodePlan } from "@/lib/opencode/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const keys = await getKeyStatuses();
  const opencodePlan: OpenCodePlan =
    process.env.OPENCODE_PLAN === "go" ? "go" : "console";
  const opencodeKey = keys.OPENCODE_API_KEY.configured;

  let opencodeModels: ModelOption[] = [];
  if (opencodeKey) {
    const key = await getKey("OPENCODE_API_KEY");
    if (key) opencodeModels = (await fetchOpenCodeModels(opencodePlan, key)) ?? [];
  }

  const directProviders = PROVIDERS.filter(
    (provider) =>
      provider.id !== "deepseek" &&
      keys[provider.keyEnv as keyof typeof keys]?.configured,
  );
  const directModels = MODELS.filter((model) =>
    directProviders.some((provider) => provider.id === model.provider),
  );

  const providers: Provider[] = [];
  if (opencodeKey) {
    providers.push({
      id: "opencode",
      label: opencodePlan === "go" ? "OpenCode Go" : "OpenCode",
      keyEnv: "OPENCODE_API_KEY",
    });
  }
  providers.push(...directProviders);

  let models: ModelOption[] = [...opencodeModels, ...directModels];

  // The live catalog is a nicety; if it fails, keep the static
  // OpenCode-capable entries so the app still runs.
  if (opencodeKey && opencodeModels.length === 0) {
    const staticOpenCode = MODELS.filter(
      (model) => model.route === "opencode" || model.provider === "deepseek",
    ).map((model) => ({
      ...model,
      provider: "opencode" as const,
      providerLabel: opencodePlan === "go" ? "OpenCode Go" : "OpenCode",
      keyEnv: "OPENCODE_API_KEY",
      go: opencodePlan === "go",
    }));
    models = [...staticOpenCode, ...directModels];
  }

  if (models.length === 0) {
    return NextResponse.json({
      providers: PROVIDERS,
      models: MODELS,
      keys,
      opencode: opencodeKey,
      opencodePlan,
    });
  }

  return NextResponse.json({
    providers,
    models,
    keys,
    opencode: opencodeKey,
    opencodePlan,
  });
}
