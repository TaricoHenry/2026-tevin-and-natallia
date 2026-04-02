import fs from "fs";
import path from "path";
import crypto from "crypto";
import admin from "firebase-admin";
import { parse } from "csv-parse/sync";

// ======================================================
// Bulk import script for Firestore household RSVP data
// ======================================================
// What this script does:
// 1. Reads a CSV export from your sheet
// 2. Groups guests into households
// 3. Generates a unique 6 character household code
// 4. Creates one Firestore document per household
// 5. Stores RSVP status per member
//
// Usage:
// node scripts/importGuests.js ./csv/guestList.csv
//
// Expected CSV headers:
// name, personalizedAddress, personalizedHousholdName, housholdSize, rsvp, Unique URL
//
// Notes:
// - household name and size headers are misspelled in the sheet, so we support both
// - if a row has no household name, it becomes a single-person household
// - if a row already has a Unique URL, the final 6-char path is reused as the code
// ======================================================

if (!process.argv[2]) {
  console.error("Usage: node scripts/importGuests.js ./guests.csv");
  process.exit(1);
}

const csvPath = path.resolve(process.argv[2]);

if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(1);
}

// If running locally with a service account:
// export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
admin.initializeApp();
const db = admin.firestore();

const COLLECTION_NAME = "InvitedGuests";
const BASE_URL = "https://tevinandnatalie.com";

// ======================================================
// Helpers
// ======================================================

function safe(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return safe(value).replace(/\s+/g, " ");
}

function normalizeRsvp(value) {
  const v = safe(value).toLowerCase();
  if (v === "yes" || v === "no") return v;
  return null;
}

function parseHouseholdSize(value) {
  const n = Number(safe(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Reuse an existing URL code if the row already has one
function codeFromUrl(url) {
  const clean = safe(url);
  if (!clean) return null;

  try {
    const parsed = new URL(clean);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const lastPart = parts[parts.length - 1];
    if (!lastPart) return null;
    return lastPart.toUpperCase();
  } catch {
    const parts = clean.split("/").filter(Boolean);
    const lastPart = parts[parts.length - 1];
    if (!lastPart) return null;
    return lastPart.toUpperCase();
  }
}

// 6 character household code
// Avoid ambiguous characters like O/0 and I/1
function generateSixCharCode(existingCodes) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  do {
    code = Array.from({ length: 6 }, () => {
      const i = crypto.randomInt(0, chars.length);
      return chars[i];
    }).join("");
  } while (existingCodes.has(code));

  existingCodes.add(code);
  return code;
}

// Build a grouping key for rows that belong together
// Priority:
// 1. Existing URL/code
// 2. Explicit household name
// 3. Person name (single household fallback)
function buildGroupingKey(row) {
  const explicitCode = codeFromUrl(row["Unique URL"] || row.uniqueUrl);
  if (explicitCode) {
    return `code:${explicitCode}`;
  }

  const householdName = normalizeText(
    row.personalizedHousholdName || row.personalizedHouseholdName
  );

  if (householdName) {
    return `household:${householdName.toLowerCase()}`;
  }

  const name = normalizeText(row.name);
  return `single:${name.toLowerCase()}`;
}

// ======================================================
// Read and parse CSV
// ======================================================

const raw = fs.readFileSync(csvPath, "utf8");

const records = parse(raw, {
  columns: true,
  skip_empty_lines: true,
  trim: true,
});

// Reserve any codes that already exist in the sheet
const usedCodes = new Set();
for (const row of records) {
  const existingCode = codeFromUrl(row["Unique URL"] || row.uniqueUrl);
  if (existingCode) {
    usedCodes.add(existingCode);
  }
}

// ======================================================
// Group records into households
// ======================================================

const households = new Map();

for (const row of records) {
  const name = normalizeText(row.name);
  const personalizedAddy = normalizeText(row.personalizedAddress);
  const householdName = normalizeText(
    row.personalizedHousholdName || row.personalizedHouseholdName
  );
  const householdSize = parseHouseholdSize(
    row.housholdSize ?? row.householdSize
  );
  const existingCode = codeFromUrl(row["Unique URL"] || row.uniqueUrl);
  const existingRsvp = normalizeRsvp(row.rsvp);

  // ignore fully empty rows
  if (!name) continue;

  const groupingKey = buildGroupingKey(row);

  if (!households.has(groupingKey)) {
    const code = existingCode || generateSixCharCode(usedCodes);

    households.set(groupingKey, {
      code,
      uniqueUrl: `${BASE_URL}/${code}`,
      household: householdName || `${name}`,
      householdSize: householdSize,
      allResponded: false,
      members: [],
    });
  }

  const household = households.get(groupingKey);

  household.members.push({
    memberId: "", // placeholder for now, assigned after grouping
    name,
    personalizedAddy: personalizedAddy || null,
    rsvp: existingRsvp,
    respondedAt: existingRsvp ? new Date().toISOString() : null,
  });

  // If household size not supplied, we'll calculate it from members
  if (!household.householdSize) {
    household.householdSize = household.members.length;
  }
}

// ======================================================
// Finalize household documents
// ======================================================

for (const [, household] of households) {
  household.members = household.members.map((member, index) => ({
    ...member,
    memberId: `${household.code}_${index + 1}`,
  }));

  household.householdSize = household.householdSize || household.members.length;

  household.allResponded =
    household.members.length > 0 &&
    household.members.every((member) => member.rsvp === "yes" || member.rsvp === "no");

  household.respondedAt = household.allResponded
    ? new Date().toISOString()
    : null;

  household.createdAt = admin.firestore.FieldValue.serverTimestamp();
  household.updatedAt = admin.firestore.FieldValue.serverTimestamp();
}

// ======================================================
// Write to Firestore
// ======================================================

async function run() {
  const batch = db.batch();
  const collectionRef = db.collection(COLLECTION_NAME);

  for (const [, household] of households) {
    const docRef = collectionRef.doc(household.code);

    batch.set(
      docRef,
      {
        code: household.code,
        uniqueUrl: household.uniqueUrl,
        household: household.household,
        householdSize: household.householdSize,
        allResponded: household.allResponded,
        respondedAt: household.respondedAt,
        members: household.members,
        createdAt: household.createdAt,
        updatedAt: household.updatedAt,
      },
      { merge: true }
    );
  }

  await batch.commit();

  console.log(
    `Imported ${households.size} household document(s) into ${COLLECTION_NAME}`
  );
}

run().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});