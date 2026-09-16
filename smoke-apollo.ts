const key = process.env.APOLLO_API_KEY!;
const url = new URL("https://api.apollo.io/api/v1/mixed_people/api_search");
url.search = new URLSearchParams({ per_page: "2", page: "1", "q_organization_domains_list[]": "acumentechnology.com" }).toString();
const r = await fetch(url, { method: "POST", headers: { Accept: "application/json", "X-Api-Key": key } });
const b: any = await r.json();
console.log(Object.keys(b));
const p = b.people?.[0] ?? {};
console.log(Object.keys(p));
console.log(JSON.stringify({ first: p.first_name, last: p.last_name, name: p.name, title: p.title, id: p.id, org: p.organization?.name ?? p.organization_name, head: p.headline, li: p.linkedin_url }, null, 2));
