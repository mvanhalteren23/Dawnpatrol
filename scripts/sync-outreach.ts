// Run the Gmail outreach sync from a shell / system cron: `npm run jobs:outreach-sync`
async function main() {
  const url = `${process.env.APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000"}/api/cron/outreach-sync`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
  console.log(res.status, await res.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
