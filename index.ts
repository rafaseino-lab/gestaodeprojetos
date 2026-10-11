// Edge Function: estimate-budget
// Estima o VALOR ORÇADO (US$) de cada item de obra usando a IA (Anthropic),
// com base no endereço/região + área em sqft + a lista de itens.
// Protege a ANTHROPIC_API_KEY no servidor (nunca vai pro navegador).
//
// Deploy no Supabase → Edge Functions → Create a function (nome: estimate-budget),
// cole este arquivo. Depois adicione o secret ANTHROPIC_API_KEY em
// Edge Functions → Secrets. (Opcional: ANTHROPIC_MODEL pra trocar o modelo.)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const jsonOut = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!KEY) return jsonOut({ error: "ANTHROPIC_API_KEY não configurada nos secrets da Edge Function." }, 400);
    const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";

    const body = await req.json().catch(() => ({}));
    const address = (body.address || "").toString();
    const sqft = Number(body.sqft) || 0;
    const items: Array<{ key: string; name: string; category?: string }> = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return jsonOut({ error: "Nenhum item enviado." }, 400);
    // Tipo de obra: "new_construction" (obra nova do zero) ou "rehab" (reforma/fix-and-flip).
    const buildTypeRaw = (body.build_type || "rehab").toString().toLowerCase();
    const isNew = /new|construc|ground|build/.test(buildTypeRaw);
    const extra = (body.instructions || "").toString(); // instruções extras opcionais (sem redeploy)

    const scope = isNew
      ? "US residential GROUND-UP NEW CONSTRUCTION (building a home from scratch). " +
        "Price the full turnkey build: site work and foundation, framing, roof, exterior envelope, " +
        "windows/doors, plumbing, electrical, HVAC, insulation/drywall, interior finishes, cabinetry, " +
        "fixtures, and typical soft costs (permits/impact fees) where relevant. New-construction $/sqft " +
        "is substantially higher than a renovation — use realistic ground-up build costs for the region, " +
        "not remodel costs."
      : "US residential FIX-AND-FLIP RENOVATIONS (remodeling an existing home). " +
        "Price remodel/renovation work using typical rehab $/sqft and unit costs for the region.";

    const sys =
      "You are a senior construction cost estimator for " + scope + " " +
      "Given a property location, its area in square feet, and a list of line items, " +
      "estimate a realistic BUDGET cost in US dollars for EACH item, using typical market pricing " +
      "for that region/city. Scale material and labor with the area where relevant. Be realistic — " +
      "neither lowball nor padded. If the region is unknown, use US national averages and say so. " +
      "Return ONLY valid JSON, no prose outside the JSON.";

    const user =
      `Job type: ${isNew ? "NEW CONSTRUCTION (ground-up build)" : "REHAB / renovation of existing home"}\n` +
      `Property address / region: ${address || "(not provided)"}\n` +
      `Area: ${sqft} sqft\n` +
      `Currency: USD\n` +
      (extra ? `Extra context: ${extra}\n` : "") +
      `\nLine items to estimate:\n` +
      items.map((it) => `- key="${it.key}" | item="${it.name}" | category="${it.category || ""}"`).join("\n") +
      `\n\nReturn a JSON object exactly like:\n` +
      `{"items":[{"key":"<same key>","est":<number USD, no $ or commas>,"note":"<short basis e.g. $/sqft or unit assumption>"}],` +
      `"assumptions":"<1-2 lines on the regional basis used>"}`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 3000, system: sys, messages: [{ role: "user", content: user }] }),
    });
    const j = await r.json();
    if (!r.ok) return jsonOut({ error: j?.error?.message || `Anthropic error (${r.status})` }, 500);

    const text = (j?.content?.[0]?.text) || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return jsonOut({ error: "A IA não retornou JSON válido.", raw: text.slice(0, 400) }, 500);
    const parsed = JSON.parse(m[0]);
    // sanitiza números
    (parsed.items || []).forEach((it: any) => { it.est = Math.max(0, Math.round((Number(it.est) || 0) * 100) / 100); });
    return jsonOut(parsed);
  } catch (e) {
    return jsonOut({ error: String(e) }, 500);
  }
});
