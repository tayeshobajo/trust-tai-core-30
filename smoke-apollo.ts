const key = process.env.APOLLO_API_KEY!;
async function call(params: Record<string,string|string[]>) {
  const url = new URL("https://api.apollo.io/api/v1/mixed_people/api_search");
  const p = new URLSearchParams({ per_page: "4", page: "1" });
  for (const [k,v] of Object.entries(params)) (Array.isArray(v)?v:[v]).forEach(x=>p.append(k,x));
  url.search = p.toString();
  const r = await fetch(url, { method: "POST", headers: { "Content-Type":"application/json", Accept:"application/json", "X-Api-Key": key } });
  const text = await r.text();
  let body: any = {}; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0,300) }; }
  console.log(JSON.stringify(params), "->", r.status, "pagination", JSON.stringify(body.pagination ?? body.error_code ?? body.error ?? body.raw ?? null),
    "people", (body.people ?? []).length, (body.people ?? []).slice(0,4).map((x:any)=>`${x.name} | ${x.title}`));
}
await call({ "q_organization_domains_list[]": "acumentechnology.com" });
await call({ q_organization_name: "Acumen Technology" });
await call({ "q_organization_domains_list[]": "udig.com" });
