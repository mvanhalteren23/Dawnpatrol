// `npm run db:seed` — creates the admin user, starter prompts and plans.
// Set SEED_DEMO=1 to also load sample prospects and one demo client.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_PROMPTS } from "../src/lib/prompts";

const db = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("Set ADMIN_PASSWORD before seeding");
  const admin = await db.user.upsert({
    where: { email },
    create: { email, name: "Admin", role: "ADMIN", passwordHash: await bcrypt.hash(password, 12) },
    update: { role: "ADMIN" },
  });
  console.log(`Admin: ${admin.email}`);

  for (const p of DEFAULT_PROMPTS) {
    if (await db.savedPrompt.findFirst({ where: { name: p.name } })) continue;
    await db.savedPrompt.create({ data: { ...p, isDefault: p.isDefault ?? false, createdById: admin.id } });
  }

  const plans = [
    { name: "Starter", priceCents: 29700, setupFeeCents: 0, includedMinutes: 300, features: "24/7 call answering\nMessage taking + SMS summaries\nKnowledge base up to 50 items" },
    { name: "Growth", priceCents: 49700, setupFeeCents: 49700, includedMinutes: 800, features: "Everything in Starter\nAppointment booking\nCall transfer & escalation\nMonthly tuning call" },
    { name: "Pro", priceCents: 99700, setupFeeCents: 99700, includedMinutes: 2000, features: "Everything in Growth\nMultiple locations / numbers\nCRM integration\nPriority support" },
  ];
  for (const p of plans) await db.plan.upsert({ where: { name: p.name }, create: p, update: {} });

  if (process.env.SEED_DEMO === "1") await demo(admin.id);
}

async function demo(ownerId: string) {
  const prospects = [
    { name: "Summit Peak HVAC", domain: "summitpeakhvac.example", industry: "HVAC", city: "Denver", state: "CO", stage: "CONTACTED", fitScore: 82 },
    { name: "Bright Smile Dental", domain: "brightsmile.example", industry: "Dental", city: "Boulder", state: "CO", stage: "DEMO", fitScore: 74 },
    { name: "Ridgeline Roofing", domain: "ridgelineroofing.example", industry: "Roofing", city: "Aurora", state: "CO", stage: "PROSPECT", fitScore: 68 },
    { name: "Castle Rock Law", domain: "castlerocklaw.example", industry: "Legal", city: "Castle Rock", state: "CO", stage: "PROPOSAL", fitScore: 77 },
  ];
  for (const p of prospects) {
    await db.account.upsert({ where: { domain: p.domain }, create: { ...p, website: `https://${p.domain}`, ownerId, source: "manual" }, update: {} });
  }
  const client = await db.account.upsert({
    where: { domain: "mountainflow.example" },
    create: { name: "Mountain Flow Plumbing", domain: "mountainflow.example", website: "https://mountainflow.example", industry: "Plumbing", city: "Lakewood", state: "CO", stage: "ACTIVE", fitScore: 90, convertedAt: new Date(), ownerId },
    update: {},
  });
  const growth = await db.plan.findUnique({ where: { name: "Growth" } });
  await db.subscription.upsert({ where: { accountId: client.id }, create: { accountId: client.id, planId: growth?.id, status: "ACTIVE", mrrCents: 49700, billingMethod: "manual", startedAt: new Date() }, update: {} });
  let r = await db.receptionist.findFirst({ where: { accountId: client.id } });
  if (!r) {
    r = await db.receptionist.create({
      data: {
        accountId: client.id,
        name: "Ava",
        businessName: "Mountain Flow Plumbing",
        businessHours: "Mon–Fri 7am–6pm\nSat 8am–12pm\nEmergency service 24/7",
        escalationPhone: "+1 303 555 0100",
        escalationRules: "Burst pipes, flooding, gas smell or no water: offer to transfer to the on-call tech immediately.",
        ragToken: randomBytes(24).toString("base64url"),
        knowledge: {
          create: [
            { category: "SERVICE", title: "Emergency plumbing", content: "24/7 emergency service for burst pipes, flooding, sewer backups and no-water situations. After-hours call-out fee is $149, waived if the repair is over $500." },
            { category: "SERVICE", title: "Water heaters", content: "We repair and install tank and tankless water heaters from all major brands. Same-day installs are usually available for standard 40 and 50 gallon tanks." },
            { category: "PRICING", title: "Diagnostic visit", content: "Standard diagnostic visit is $89 during business hours, credited toward the repair." },
            { category: "LOCATION", title: "Service area", content: "Lakewood, Golden, Wheat Ridge, Arvada and west Denver. Outside that area we can usually come out for an added $50 travel fee." },
            { category: "FAQ", title: "Do you offer financing?", content: "Yes — financing is available on jobs over $1,000 with approved credit." },
            { category: "POLICY", title: "Warranty", content: "All labour is guaranteed for 1 year. Parts carry the manufacturer's warranty." },
          ],
        },
      },
    });
    const now = Date.now();
    await db.callLog.createMany({
      data: [
        { receptionistId: r.id, externalId: "demo-1", callerName: "Jessica M.", callerNumber: "+1 720 555 0142", startedAt: new Date(now - 3600e3), durationSec: 184, outcome: "BOOKED", summary: "Water heater leaking; booked Tuesday 9am diagnostic." },
        { receptionistId: r.id, externalId: "demo-2", callerName: "Tom R.", callerNumber: "+1 303 555 0199", startedAt: new Date(now - 7200e3), durationSec: 96, outcome: "MESSAGE_TAKEN", followUpNeeded: true, summary: "Wants a quote for re-piping a 1960s house. Asked for a call back after 5pm." },
        { receptionistId: r.id, externalId: "demo-3", callerNumber: "+1 720 555 0110", startedAt: new Date(now - 86400e3), durationSec: 41, outcome: "TRANSFERRED", summary: "Burst pipe in basement — transferred to on-call tech." },
      ],
    });
  }
  console.log("Demo data loaded");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
