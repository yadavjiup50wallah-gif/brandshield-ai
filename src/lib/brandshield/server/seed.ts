import { createHash } from "crypto";
import { db } from "@/lib/db";
import { chunkDocument } from "./engine";
import { hashPassword, verifyPassword } from "./password";
import { DEMO_EMAILS } from "../shared";

// ─── Seed content: Nimbus Labs brand governance workspace ────────────────────

const VOICE_PLAYBOOK = `NIMBUSPAY VOICE & TONE PLAYBOOK v3.2

RULE VOICE-01: NimbusPay speaks as a friendly expert. We are confident, warm, and precise — never hypey, never cold. Write like a knowledgeable colleague, not a salesperson.

RULE VOICE-02: Plain language wins. Prefer short sentences (under 22 words). Avoid legalese in marketing copy; legal disclaimers belong in product surfaces, not campaigns.

RULE VOICE-03: Hype is banned. Do not use superlatives (best, fastest, world-class, revolutionary) unless backed by a cited, verifiable third-party benchmark in the approved facts repository.

RULE VOICE-04: Never use absolute guarantees ("guaranteed", "risk-free", "100% safe", "can't fail"). Financial products require hedged, factual phrasing such as "designed to", "typically", "on average".

RULE VOICE-05: Celebrate customer outcomes with real numbers from the approved Product Facts datasheet only. Any performance metric must trace to that document.

RULE STYLE-01: Punctuation. Single exclamation marks only, at most one per paragraph. Never combine "?!" or "!!". Bold or emphasized text replaces ALL-CAPS shouting.

RULE STYLE-02: Sentence case for headlines. Title Case is reserved for product names and official campaign titles registered with Brand Ops.

VOICE DESCRIPTORS: friendly-expert, precise, optimistic, transparent, calm confidence, plain-spoken, customer-championing.
AVOIDS: slang, hype adjectives, legalese, urgency pressure tactics, unexplained jargon.`;

const PRODUCT_FACTS = `NIMBUSPAY PRODUCT FACTS — APPROVED DATASHEET Q3 2025 (Source of Truth)

FACT PD-01: NimbusPay processes payments in 32 currencies across 14 markets.

FACT PD-02: Standard settlement time is 2 business days for verified merchants. Express settlement (same-day) is available on the Scale plan in 6 markets.

FACT PD-03: NimbusPay maintains a 99.95% uptime SLA over the trailing 12 months, independently audited.

FACT PD-04: Active merchant count: 14,238 verified businesses as of the Q3 2025 report.

FACT PD-05: Average merchant onboarding time is 27 minutes using the guided API and pre-built checkout components.

FACT PD-06: Standard processing fee is 1.9% + $0.30 per transaction. Volume discounts begin at $80k monthly volume.

FACT PD-07: NimbusPay was founded in 2019 and is SOC 2 Type II certified and PCI DSS Level 1 compliant.

FACT PD-08: NimbusPay partners with 46 licensed regional banks for local acquiring.

FACT PD-09: Merchant churn reduction: merchants using NimbusPay Smart Retries recover 11.4% more failed payments on average (internal measurement, Q1–Q3 2025).

FACT PD-10: The company does NOT publish average merchant ROI figures. No ROI multiplier claims are approved for any channel.`;

const TRADEMARK_RULES = `TRADEMARK & NAMING RULES — NIMBUSPAY LEGAL

RULE TM-01: NimbusPay|® — The master brand "NimbusPay" is a registered trademark. The first prominent use in any asset must carry the ® glyph. Always written as one word, camel case: "NimbusPay". Never "Nimbus Pay", "nimbuspay", or "NIMBUSPAY" in running copy.

RULE TM-02: Nimbus Shield|™ — The fraud-protection suite "Nimbus Shield" carries the ™ glyph on first use per asset.

RULE TM-03: Product names are always camel case single words: PayLinks™, SmartRetries™, CheckoutOS™.

RULE TM-04: Do not use the ® or ™ glyph in headlines larger than 48px; use a legal footnote instead.`;

const BANNED_WORDS = `BANNED & RESTRICTED TERMS — NIMBUSPAY MARKETING LEGAL LIST v7
(Any appearance in external copy is a blocking violation)

guaranteed
guarantees
risk-free
100% safe
can't fail
world's best
world-class
revolutionary
cheapest
instantly
instantly approved
miracle
magic
hack
unbeatable
zero risk
no risk
effortless
overnight success
get rich
fastest ever
#1
number one`;

const TERMINOLOGY = `NIMBUSPAY TERMINOLOGY LIST — SAY THIS, NOT THAT

TERM LG-01: Say "customer" or "merchant" — never "user" in external copy.
TERM LG-02: Say "workspace" — never "dashboard" for the merchant home.
TERM LG-03: Say "payout" — never "withdrawal" (positive framing).
TERM LG-04: Say "team members" — never "seats" in customer-facing copy.
TERM LG-05: Currency amounts: "$1,240.50" — symbol, thousands separator, two decimals.
TERM LG-06: Say "sign in" not "log in"; say "set up" (verb) not "setup" (verb).`;

// ─── Visual tokens ───────────────────────────────────────────────────────────

const SHIELD_LOGO_SVG =
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14B8A6"/><stop offset="1" stop-color="#0F766E"/></linearGradient></defs><path d="M48 6 84 20v26c0 22-15 38-36 44C27 84 12 68 12 46V20L48 6z" fill="url(#g)"/><path d="M32 47l11 11 22-23" stroke="#F8FAFC" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  ).toString("base64");

// ─── Seed helper ─────────────────────────────────────────────────────────────

function chain(entries: { action: string; actorId: string; details: Record<string, unknown>; ts: Date }[]) {
  let prev = "GENESIS";
  return entries.map((e) => {
    const contentHash = createHash("sha256")
      .update(JSON.stringify({ prevHash: prev, ...e, ts: e.ts.getTime() }))
      .digest("hex");
    const row = { ...e, prevHash: prev, contentHash };
    prev = contentHash;
    return row;
  });
}

let seedPromise: Promise<void> | null = null;

/**
 * Whether the one-click demo workspace (Nimbus Labs personas) may be created.
 *
 * Set DEMO_SEED=off in production hosting (Vercel → Environment Variables) to
 * start with a completely clean database — real users then sign up via the
 * "Create account" tab and every row is real data. Unset (or any other value)
 * keeps the sandbox/demo behavior where the first auth call seeds the demo.
 */
export function isDemoWorkspaceEnabled(): boolean {
  const v = (process.env.DEMO_SEED ?? "").trim().toLowerCase();
  return v !== "off" && v !== "0" && v !== "false";
}

export function ensureSeed(): Promise<void> {
  if (!isDemoWorkspaceEnabled()) return Promise.resolve();
  if (!seedPromise) {
    seedPromise = seedInternal().catch((e) => {
      seedPromise = null;
      throw e;
    });
  }
  return seedPromise;
}

async function seedInternal(): Promise<void> {
  const demoPasswordHash = await hashPassword("demo1234");
  const demoPersonas = [
    { email: "ava@nimbus.demo", name: "Ava Chen", role: "creator", department: "Content Studio", avatarColor: "#0F766E" },
    { email: "marcus@nimbus.demo", name: "Marcus Reed", role: "reviewer", department: "Brand & Legal", avatarColor: "#B45309" },
    { email: "priya@pixelworks.demo", name: "Priya Sharma", role: "contractor", department: "PixelWorks Agency", avatarColor: "#7C2D12" },
    { email: "elena@nimbus.demo", name: "Elena Rodriguez", role: "admin", department: "Marketing Leadership", avatarColor: "#4D7C0F" },
  ];

  const existing = await db.organization.findUnique({ where: { slug: "nimbus-labs" } });
  if (existing) {
    // Self-healing: verify every demo persona exists and their password matches "demo1234"
    for (const p of demoPersonas) {
      const user = await db.user.findUnique({ where: { email: p.email } });
      if (!user) {
        await db.user.create({
          data: { ...p, orgId: existing.id, password: demoPasswordHash },
        });
      } else {
        const { valid } = await verifyPassword("demo1234", user.password);
        if (!valid) {
          await db.user.update({
            where: { id: user.id },
            data: { password: demoPasswordHash, orgId: existing.id },
          });
        }
      }
    }
    return;
  }

  // ── Organization + users (demo personas — passwords salted-scrypt hashed) ──
  const org = await db.organization.create({
    data: { name: "Nimbus Labs", slug: "nimbus-labs", zeroDataRetention: true },
  });

  const [ava, marcus, priya, elena] = await Promise.all(
    demoPersonas.map((u) => db.user.create({ data: { ...u, orgId: org.id, password: demoPasswordHash } }))
  );

  // ── Guideline documents + chunks
  const docs: { title: string; docType: string; content: string }[] = [
    { title: "Voice & Tone Playbook", docType: "tone", content: VOICE_PLAYBOOK },
    { title: "Product Facts Datasheet Q3 2025", docType: "datasheet", content: PRODUCT_FACTS },
    { title: "Trademark & Naming Rules", docType: "trademark", content: TRADEMARK_RULES },
    { title: "Banned & Restricted Terms", docType: "banned_words", content: BANNED_WORDS },
    { title: "Terminology List", docType: "terminology", content: TERMINOLOGY },
  ];
  for (const d of docs) {
    const chunks = chunkDocument(d.content);
    await db.guidelineDocument.create({
      data: {
        orgId: org.id,
        title: d.title,
        docType: d.docType,
        content: d.content,
        sourceName: `${d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`,
        chunkCount: chunks.length,
        chunks: { create: chunks.map((c) => ({ orgId: org.id, chunkIndex: c.chunkIndex, text: c.text, ruleTag: c.ruleTag, keywords: c.keywords })) },
      },
    });
  }

  // ── Visual tokens
  await db.visualToken.createMany({
    data: [
      { orgId: org.id, tokenType: "color", name: "Shield Teal", value: "#0F766E", secondary: "#F8FAFC", usageNotes: "Primary brand color. Use for headers, CTAs, and key moments." },
      { orgId: org.id, tokenType: "color", name: "Aqua Mint", value: "#14B8A6", secondary: "#0F172A", usageNotes: "Secondary accent. Gradients with Shield Teal only." },
      { orgId: org.id, tokenType: "color", name: "Amber Accent", value: "#F59E0B", secondary: "#0F172A", usageNotes: "Highlight accents, badges, never body text on white." },
      { orgId: org.id, tokenType: "color", name: "Ink", value: "#0F172A", secondary: "#F8FAFC", usageNotes: "Headline text color on light backgrounds." },
      { orgId: org.id, tokenType: "color", name: "Cloud", value: "#F8FAFC", secondary: "#0F172A", usageNotes: "Light section backgrounds." },
      { orgId: org.id, tokenType: "typography", name: "Headings — Geist SemiBold", value: "Geist Sans / 600 / -0.02em tracking", secondary: null, usageNotes: "H1 40–56px, H2 28–36px. Sentence case per STYLE-02." },
      { orgId: org.id, tokenType: "typography", name: "Body — Geist Regular", value: "Geist Sans / 400 / 16–18px / 1.6 line height", secondary: null, usageNotes: "Max 70ch measure." },
      { orgId: org.id, tokenType: "logo", name: "Nimbus Shield Mark", value: SHIELD_LOGO_SVG, secondary: null, usageNotes: "Primary logo. Clear space = 1/2 mark height. Never place on low-contrast backgrounds." },
    ],
  });

  // ── Subscription (Growth plan active)
  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + 18);
  await db.subscription.create({
    data: { orgId: org.id, tier: "growth", status: "active", scanLimit: -1, scansUsed: 14, seats: 12, priceCents: 19900, currentPeriodEnd: periodEnd },
  });

  // ── Submission 1: Creator draft with rich violations (Stage 3 demo)
  const s1Content = `Introducing the NimbusPay Spring Boost!

Our new merchants see 10x ROI in 7 days — guaranteed. nimbuspay is the world's best payment platform!!! Sign up TODAY and enjoy risk-free onboarding.

We process 180+ currencies and settle funds instantly. Trusted by over 50,000 merchants across 120 countries since 2019.`;

  const s1 = await db.submission.create({
    data: {
      orgId: org.id,
      authorId: ava.id,
      title: "Spring Boost Campaign — Email Hero",
      contentType: "text",
      content: s1Content,
      status: "draft",
      complianceScore: 37,
      scanCount: 1,
      department: "Content Studio",
      creatorNote: "Hero copy for the spring re-engagement email. Targeting lapsed merchants.",
    },
  });
  await db.revision.create({ data: { submissionId: s1.id, version: 1, content: s1Content, changeSummary: "Initial draft", authorId: ava.id } });
  await db.inspection.create({
    data: {
      submissionId: s1.id,
      durationMs: 6420,
      complianceScore: 37,
      stageA: JSON.stringify({
        durationMs: 1.8,
        bannedTerms: [
          { term: "guaranteed", index: 62, excerpt: "10x ROI in 7 days — guaranteed" },
          { term: "world's best", index: 118, excerpt: "nimbuspay is the world's best payment platform" },
          { term: "risk-free", index: 178, excerpt: "enjoy risk-free onboarding" },
        ],
        trademarkIssues: [{ brand: "NimbusPay", expectedGlyph: "®", index: 97, excerpt: "nimbuspay is the world's best payment platform" }],
        claimCandidates: [
          "Our new merchants see 10x ROI in 7 days — guaranteed.",
          "We process 180+ currencies and settle funds instantly.",
          "Trusted by over 50,000 merchants across 120 countries since 2019.",
        ],
        hexCodesFound: [],
        styleIssues: [{ type: "excessive-punctuation", excerpt: "!!!", detail: "Repeated exclamation marks read as hype; brand voice prefers confident, measured statements." }],
        checks: [
          { name: "Banned terms", passed: false, count: 3, ms: 0.21 },
          { name: "Trademark glyphs", passed: false, count: 1, ms: 0.14 },
          { name: "Claim candidates", passed: true, count: 3, ms: 0.42 },
          { name: "Hex discovery", passed: true, count: 0, ms: 0.05 },
          { name: "Style mechanics", passed: false, count: 1, ms: 0.33 },
        ],
      }),
      stageB: JSON.stringify({
        durationMs: 6418,
        tone: {
          score: 41,
          voiceSummary: "Copy leans heavily on hype, urgency and unverified superlatives — far from the friendly-expert voice.",
          driftFlags: [{ phrase: "Sign up TODAY", reason: "Urgency pressure tactic with all-caps shouting.", suggestion: "Sign up today" }],
        },
        claimVerdicts: [
          { claim: "Our new merchants see 10x ROI in 7 days — guaranteed.", verdict: "UNSUPPORTED", citation: "FACT PD-10: The company does NOT publish average merchant ROI figures. No ROI multiplier claims are approved for any channel.", sourceDoc: "Product Facts Datasheet Q3 2025", rationale: "No approved ROI multiplier exists; an explicit guarantee also breaches VOICE-04.", suggestion: "Our new merchants typically recover 11.4% more failed payments with Smart Retries." },
          { claim: "We process 180+ currencies and settle funds instantly.", verdict: "UNSUPPORTED", citation: "FACT PD-01: NimbusPay processes payments in 32 currencies across 14 markets. FACT PD-02: Standard settlement time is 2 business days.", sourceDoc: "Product Facts Datasheet Q3 2025", rationale: "Currency count and settlement speed contradict the approved datasheet.", suggestion: "We process payments in 32 currencies and settle funds in 2 business days." },
          { claim: "Trusted by over 50,000 merchants across 120 countries since 2019.", verdict: "UNSUPPORTED", citation: "FACT PD-04: Active merchant count: 14,238 verified businesses as of the Q3 2025 report. FACT PD-01: 14 markets.", sourceDoc: "Product Facts Datasheet Q3 2025", rationale: "Merchant count and market coverage are inflated versus the approved report.", suggestion: "Trusted by 14,000+ merchants across 14 markets since 2019." },
        ],
        vision: null,
      }),
    },
  });
  await db.finding.createMany({
    data: [
      { submissionId: s1.id, severity: "critical", category: "claim", flaggedText: "Our new merchants see 10x ROI in 7 days — guaranteed.", ruleCitation: "FACT PD-10: The company does NOT publish average merchant ROI figures. No ROI multiplier claims are approved for any channel.", sourceDoc: "Product Facts Datasheet Q3 2025", rationale: "No approved ROI multiplier exists; an explicit guarantee also breaches VOICE-04.", suggestion: "Our new merchants typically recover 11.4% more failed payments with Smart Retries.", stage: "ai" },
      { submissionId: s1.id, severity: "critical", category: "claim", flaggedText: "We process 180+ currencies and settle funds instantly.", ruleCitation: "FACT PD-01: NimbusPay processes payments in 32 currencies across 14 markets. FACT PD-02: Standard settlement time is 2 business days.", sourceDoc: "Product Facts Datasheet Q3 2025", rationale: "Currency count and settlement speed contradict the approved datasheet.", suggestion: "We process payments in 32 currencies and settle funds in 2 business days.", stage: "ai" },
      { submissionId: s1.id, severity: "warning", category: "claim", flaggedText: "Trusted by over 50,000 merchants across 120 countries since 2019.", ruleCitation: "FACT PD-04: Active merchant count: 14,238 verified businesses as of the Q3 2025 report.", sourceDoc: "Product Facts Datasheet Q3 2025", rationale: "Merchant count and market coverage are inflated versus the approved report.", suggestion: "Trusted by 14,000+ merchants across 14 markets since 2019.", stage: "ai" },
      { submissionId: s1.id, severity: "warning", category: "style", flaggedText: "guaranteed", ruleCitation: "Banned & Restricted Terms — term is prohibited in all external copy", sourceDoc: "Banned & Restricted Terms", rationale: "\"guaranteed\" appears in the restricted vocabulary list and risks deceptive-marketing scrutiny.", stage: "deterministic" },
      { submissionId: s1.id, severity: "warning", category: "style", flaggedText: "risk-free", ruleCitation: "Banned & Restricted Terms — term is prohibited in all external copy", sourceDoc: "Banned & Restricted Terms", rationale: "\"risk-free\" appears in the restricted vocabulary list and risks deceptive-marketing scrutiny.", stage: "deterministic" },
      { submissionId: s1.id, severity: "warning", category: "trademark", flaggedText: "nimbuspay", ruleCitation: "RULE TM-01: The master brand \"NimbusPay\" is a registered trademark and must be written camel-case with the ® glyph.", sourceDoc: "Trademark & Naming Rules", rationale: "The brand name appears lowercase and missing its required ® registration mark.", suggestion: "NimbusPay®", stage: "deterministic" },
      { submissionId: s1.id, severity: "minor", category: "style", flaggedText: "!!!", ruleCitation: "RULE STYLE-01: Single exclamation marks only, never combined.", sourceDoc: "Voice & Tone Playbook", rationale: "Repeated exclamation marks read as hype; brand voice prefers confident, measured statements.", stage: "deterministic" },
      { submissionId: s1.id, severity: "warning", category: "tone", flaggedText: "Sign up TODAY", ruleCitation: "RULE VOICE-01: NimbusPay speaks as a friendly expert — never hypey, never cold.", sourceDoc: "Voice & Tone Playbook", rationale: "Urgency pressure tactic with all-caps shouting.", suggestion: "Sign up today", stage: "ai" },
    ],
  });

  // ── Submission 2: Contractor sandbox copy (in_review)
  const s3Content = `Partner announcement draft:

With NimbusPay, your merchants can onboard in under 10 minutes and start accepting payments in 46 markets. nimbuspay handles payouts, fraud and reporting in one workspace.

Ready to grow together? Let's build something great.`;

  const s3 = await db.submission.create({
    data: {
      orgId: org.id,
      authorId: priya.id,
      title: "PixelWorks × NimbusPay — Partner Announcement",
      contentType: "text",
      content: s3Content,
      status: "in_review",
      complianceScore: 62,
      scanCount: 2,
      department: "PixelWorks Agency",
      creatorNote: "Co-marketing announcement for the partner newsletter, pre-checked in the agency sandbox.",
    },
  });
  await db.revision.create({ data: { submissionId: s3.id, version: 1, content: s3Content, changeSummary: "Agency first pass", authorId: priya.id } });
  await db.inspection.create({
    data: {
      submissionId: s3.id,
      durationMs: 5210,
      complianceScore: 62,
      stageA: JSON.stringify({
        durationMs: 1.4,
        bannedTerms: [],
        trademarkIssues: [{ brand: "NimbusPay", expectedGlyph: "®", index: 143, excerpt: "nimbuspay handles payouts, fraud and reporting" }],
        claimCandidates: [
          "With NimbusPay, your merchants can onboard in under 10 minutes and start accepting payments in 46 markets.",
        ],
        hexCodesFound: [],
        styleIssues: [],
        checks: [
          { name: "Banned terms", passed: true, count: 0, ms: 0.18 },
          { name: "Trademark glyphs", passed: false, count: 1, ms: 0.11 },
          { name: "Claim candidates", passed: true, count: 1, ms: 0.31 },
          { name: "Hex discovery", passed: true, count: 0, ms: 0.04 },
          { name: "Style mechanics", passed: true, count: 0, ms: 0.09 },
        ],
      }),
      stageB: JSON.stringify({
        durationMs: 5208,
        tone: { score: 86, voiceSummary: "Warm and confident; closely matches the friendly-expert voice.", driftFlags: [] },
        claimVerdicts: [
          { claim: "With NimbusPay, your merchants can onboard in under 10 minutes and start accepting payments in 46 markets.", verdict: "UNSUPPORTED", citation: "FACT PD-05: Average merchant onboarding time is 27 minutes. FACT PD-08: NimbusPay partners with 46 licensed regional banks (not markets).", sourceDoc: "Product Facts Datasheet Q3 2025", rationale: "Onboarding time is understated and market count confuses partner banks with markets.", suggestion: "With NimbusPay, your merchants typically onboard in under 30 minutes and start accepting payments across 14 markets." },
        ],
        vision: null,
      }),
    },
  });
  await db.finding.createMany({
    data: [
      { submissionId: s3.id, severity: "critical", category: "claim", flaggedText: "With NimbusPay, your merchants can onboard in under 10 minutes and start accepting payments in 46 markets.", ruleCitation: "FACT PD-05: Average merchant onboarding time is 27 minutes. FACT PD-01: 14 markets.", sourceDoc: "Product Facts Datasheet Q3 2025", rationale: "Onboarding time is understated and market count confuses partner banks with markets.", suggestion: "With NimbusPay, your merchants typically onboard in under 30 minutes and start accepting payments across 14 markets.", stage: "ai" },
      { submissionId: s3.id, severity: "warning", category: "trademark", flaggedText: "nimbuspay", ruleCitation: "RULE TM-01: The master brand must be written camel-case with the ® glyph.", sourceDoc: "Trademark & Naming Rules", rationale: "Brand appears lowercase and missing the ® registration mark.", suggestion: "NimbusPay®", stage: "deterministic" },
    ],
  });

  // ── Submission 3: Approved + audit chain (Stage 4 demo with diff)
  const v1 = `NimbusPay Smart Retries — Launch Note

Failed payments aren't the end of the story. SmartRetries™ recovers failed payments automatically, so your team keeps the revenue it already earned.

Merchants using Smart Retries recover 11.4% more failed payments on average. Setup takes minutes in your workspace.`;
  const v2 = `NimbusPay® Smart Retries — Launch Note

Failed payments aren't the end of the story. SmartRetries™ recovers failed payments automatically, so your team keeps the revenue it already earned.

Merchants using Smart Retries recover 11.4% more failed payments on average. Setup takes minutes in your workspace.`;

  const s4 = await db.submission.create({
    data: {
      orgId: org.id,
      authorId: ava.id,
      title: "SmartRetries Launch Note",
      contentType: "text",
      content: v2,
      status: "approved",
      complianceScore: 100,
      scanCount: 3,
      currentVersion: 2,
      department: "Content Studio",
      creatorNote: "Product launch note for the merchant newsletter.",
    },
  });
  await db.revision.create({ data: { submissionId: s4.id, version: 1, content: v1, changeSummary: "Initial draft", authorId: ava.id } });
  await db.revision.create({ data: { submissionId: s4.id, version: 2, content: v2, changeSummary: "Added ® glyph per TM-01 after review", authorId: ava.id } });
  await db.inspection.create({
    data: { submissionId: s4.id, durationMs: 4870, complianceScore: 100, stageA: JSON.stringify({ durationMs: 1.2, bannedTerms: [], trademarkIssues: [], claimCandidates: ["Merchants using Smart Retries recover 11.4% more failed payments on average."], hexCodesFound: [], styleIssues: [], checks: [{ name: "Banned terms", passed: true, count: 0, ms: 0.16 }, { name: "Trademark glyphs", passed: true, count: 0, ms: 0.1 }, { name: "Claim candidates", passed: true, count: 1, ms: 0.28 }, { name: "Hex discovery", passed: true, count: 0, ms: 0.03 }, { name: "Style mechanics", passed: true, count: 0, ms: 0.07 }] }), stageB: JSON.stringify({ durationMs: 4868, tone: { score: 93, voiceSummary: "Calm, confident, and customer-championing — on-voice.", driftFlags: [] }, claimVerdicts: [{ claim: "Merchants using Smart Retries recover 11.4% more failed payments on average.", verdict: "SUPPORTED", citation: "FACT PD-09: merchants using NimbusPay Smart Retries recover 11.4% more failed payments on average (internal measurement, Q1–Q3 2025).", sourceDoc: "Product Facts Datasheet Q3 2025", rationale: "Metric matches the approved internal measurement exactly.", suggestion: "" }], vision: null }) },
  });
  await db.finding.create({
    data: {
      submissionId: s4.id, severity: "warning", category: "trademark", flaggedText: "NimbusPay", ruleCitation: "RULE TM-01: First prominent use must carry the ® glyph.", sourceDoc: "Trademark & Naming Rules", rationale: "Title use was missing the ® registration mark.", suggestion: "NimbusPay®", stage: "deterministic", status: "resolved", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 30), resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 20),
    },
  });

  const day = 24 * 60 * 60 * 1000;
  const chainRows = chain([
    { action: "SUBMITTED", actorId: ava.id, details: { submissionId: s4.id, title: "SmartRetries Launch Note", version: 1 }, ts: new Date(Date.now() - 3 * day) },
    { action: "SCAN", actorId: ava.id, details: { submissionId: s4.id, findings: 1, score: 90 }, ts: new Date(Date.now() - 3 * day + 120000) },
    { action: "SIGN_OFF", actorId: marcus.id, details: { submissionId: s4.id, note: "Claim verified against FACT PD-09; ® glyph fix requested.", hash: createHash("sha256").update(`${s4.id}|${v1}|${marcus.id}`).digest("hex") }, ts: new Date(Date.now() - 2 * day) },
    { action: "CHANGES_REQUESTED", actorId: marcus.id, details: { submissionId: s4.id, note: "Please add the ® glyph on first prominent brand use (TM-01)." }, ts: new Date(Date.now() - 2 * day + 60000) },
    { action: "SCAN", actorId: ava.id, details: { submissionId: s4.id, findings: 0, score: 100 }, ts: new Date(Date.now() - 1 * day) },
    { action: "APPROVAL", actorId: marcus.id, details: { submissionId: s4.id, note: "All flags resolved. Cleared for publication.", certificate: true }, ts: new Date(Date.now() - 1 * day + 300000) },
  ]);
  for (const row of chainRows) {
    await db.auditLog.create({ data: { orgId: org.id, submissionId: s4.id, actorId: row.actorId, action: row.action, details: JSON.stringify(row.details), contentHash: row.contentHash, prevHash: row.prevHash, createdAt: row.ts } });
  }

  // ── Submission 4: Changes requested (reviewer feedback demo)
  const s5Content = `Growth team webinar promo:

Join our webinar and learn how NimbusPay customers cut failed payments by 40% in one week. Seats are limited — reserve yours now!`;

  const s5 = await db.submission.create({
    data: {
      orgId: org.id,
      authorId: ava.id,
      title: "Webinar Promo — Payments Recovery",
      contentType: "text",
      content: s5Content,
      status: "changes_requested",
      complianceScore: 65,
      scanCount: 1,
      department: "Content Studio",
      creatorNote: "Promo blurb for the September webinar.",
    },
  });
  await db.revision.create({ data: { submissionId: s5.id, version: 1, content: s5Content, changeSummary: "Initial draft", authorId: ava.id } });
  await db.finding.createMany({
    data: [
      { submissionId: s5.id, severity: "critical", category: "claim", flaggedText: "Join our webinar and learn how NimbusPay customers cut failed payments by 40% in one week.", ruleCitation: "FACT PD-09: Smart Retries recover 11.4% more failed payments on average. No 40% one-week figure exists.", sourceDoc: "Product Facts Datasheet Q3 2025", rationale: "The 40% one-week reduction is not in the approved facts and overstates FACT PD-09.", suggestion: "Join our webinar and learn how merchants recover 11.4% more failed payments with Smart Retries.", stage: "ai" },
    ],
  });
  await db.auditLog.create({
    data: {
      orgId: org.id, submissionId: s5.id, actorId: marcus.id, action: "CHANGES_REQUESTED",
      details: JSON.stringify({ submissionId: s5.id, note: "40% claim is not in the approved facts — please cite FACT PD-09 instead." }),
      contentHash: createHash("sha256").update(`${s5.id}|changes|${Date.now()}`).digest("hex"), prevHash: chainRows[chainRows.length - 1].contentHash,
      createdAt: new Date(Date.now() - 0.4 * day),
    },
  });

  // ── Banner submission with off-brand palette (image generated separately)
  const s2 = await db.submission.create({
    data: {
      orgId: org.id,
      authorId: priya.id,
      title: "Summer Splash — Social Banner",
      contentType: "banner",
      content: "Summer Splash Sale — Up to 30% off NimbusPay fees for new merchants!",
      imageData: "/banners/summer-splash.png",
      imagePalette: JSON.stringify(["#FCE7F3", "#7C3AED", "#A78BFA", "#111827"]),
      status: "draft",
      complianceScore: 55,
      scanCount: 1,
      department: "PixelWorks Agency",
      creatorNote: "Instagram promo banner for the summer campaign.",
    },
  });
  await db.inspection.create({
    data: {
      submissionId: s2.id,
      durationMs: 7340,
      complianceScore: 55,
      stageA: JSON.stringify({ durationMs: 1.1, bannedTerms: [], trademarkIssues: [], claimCandidates: ["Summer Splash Sale — Up to 30% off NimbusPay fees for new merchants!"], hexCodesFound: ["#7C3AED"], styleIssues: [], checks: [{ name: "Banned terms", passed: true, count: 0, ms: 0.12 }, { name: "Trademark glyphs", passed: true, count: 0, ms: 0.09 }, { name: "Claim candidates", passed: true, count: 1, ms: 0.26 }, { name: "Hex discovery", passed: true, count: 1, ms: 0.03 }, { name: "Style mechanics", passed: true, count: 0, ms: 0.06 }] }),
      stageB: JSON.stringify({
        durationMs: 7338,
        tone: null,
        claimVerdicts: [],
        vision: {
          dominantColors: ["#FCE7F3", "#7C3AED", "#A78BFA", "#111827"],
          offBrandColors: ["#7C3AED", "#A78BFA", "#FCE7F3"],
          contrastIssues: [{ foreground: "#A78BFA", background: "#FCE7F3", ratio: 2.1, requirement: "WCAG 2.1 AA requires ≥ 4.5:1 for normal text" }],
          logoPresent: false,
          ocrText: "Summer Splash Sale — Up to 30% off NimbusPay fees for new merchants!",
          summary: "Banner uses an off-brand purple/violet palette outside the approved tokens, and the Nimbus Shield logo is absent.",
        },
      }),
    },
  });
  await db.finding.createMany({
    data: [
      { submissionId: s2.id, severity: "critical", category: "visual", flaggedText: "Text #A78BFA on #FCE7F3", ruleCitation: "WCAG 2.1 AA — contrast ratio must be ≥ 4.5:1 (measured 2.1:1)", sourceDoc: "Accessibility & Visual Tokens", rationale: "Foreground #A78BFA on background #FCE7F3 yields only 2.1:1, below the 4.5:1 AA threshold.", suggestion: "Use #0F172A text on #FCE7F3 for guaranteed AA compliance.", suggestedHex: "#0F172A", stage: "vision" },
      { submissionId: s2.id, severity: "warning", category: "visual", flaggedText: "#7C3AED", ruleCitation: "Visual Token Registry — only approved hex values may appear in creative assets", sourceDoc: "Visual Token Registry", rationale: "#7C3AED is not part of the approved palette. Nearest official token is #0F766E (Shield Teal).", suggestion: "Replace #7C3AED with #0F766E", suggestedHex: "#0F766E", stage: "vision" },
      { submissionId: s2.id, severity: "warning", category: "visual", flaggedText: "#A78BFA", ruleCitation: "Visual Token Registry — only approved hex values may appear in creative assets", sourceDoc: "Visual Token Registry", rationale: "#A78BFA is not part of the approved palette. Nearest official token is #14B8A6 (Aqua Mint).", suggestion: "Replace #A78BFA with #14B8A6", suggestedHex: "#14B8A6", stage: "vision" },
    ],
  });

  // ── A few extra historic audit entries for billing + analytics texture
  const extra = chain([
    { action: "SUBSCRIPTION", actorId: elena.id, details: { event: "subscription.started", tier: "growth", seats: 12 }, ts: new Date(Date.now() - 21 * day) },
    { action: "SCAN", actorId: priya.id, details: { sandbox: true, tier: "growth" }, ts: new Date(Date.now() - 5 * day) },
    { action: "SCAN", actorId: ava.id, details: { sandbox: false }, ts: new Date(Date.now() - 4 * day) },
  ]);
  for (const row of extra) {
    await db.auditLog.create({ data: { orgId: org.id, submissionId: null, actorId: row.actorId, action: row.action, details: JSON.stringify(row.details), contentHash: row.contentHash, prevHash: row.prevHash, createdAt: row.ts } });
  }

  console.log("✅ BrandShield seed complete: Nimbus Labs workspace is ready");
}
