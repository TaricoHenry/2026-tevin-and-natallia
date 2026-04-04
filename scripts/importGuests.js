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
// 2. Groups guests into households using household-size blocks
// 3. Generates or reuses a unique 6 character household code
// 4. Creates one Firestore document per household
// 5. Stores RSVP status per member
// 6. Exports warnings to CSV for review
// 7. Exports a preview CSV for comparison with frontend export
// 8. Supports dry-run mode to skip Firestore writes
//
// Usage:
// node scripts/importGuests.js ./csv/guestList.csv
// node scripts/importGuests.js ./csv/guestList.csv --dry-run
//
// Expected CSV headers:
// name, personalizedAddress, personalizedHousholdName, housholdSize, rsvp, Unique URL
//
// Notes:
// - household name and size headers are misspelled in the sheet, so we support both
// - rows with household size start a new household block
// - the next N rows belong to that household, where N = household size
// - repeated household names later in the file are treated as separate households
// - if a row already has a Unique URL, the final path segment is reused as the code
// ======================================================

if (!process.argv[2]) {
  console.error("Usage: node scripts/importGuests.js ./guests.csv [--dry-run]");
  process.exit(1);
}

const csvPath = path.resolve(process.argv[2]);
const isDryRun = process.argv.includes("--dry-run");

if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(1);
}

// If running locally with a service account:
// export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
admin.initializeApp();
const db = admin.firestore();

const COLLECTION_NAME = "InvitedGuests";
const BASE_URL = "https://tevinandnatallia.com";

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

function isMeaningfullyEmptyRow(row) {
  const name = normalizeText(row.name);
  const addy = normalizeText(row.personalizedAddress);
  const householdName = normalizeText(
    row.personalizedHousholdName || row.personalizedHouseholdName
  );
  const url = safe(row["Unique URL"] || row.uniqueUrl);
  const rsvp = safe(row.rsvp);
  const size = safe(row.housholdSize ?? row.householdSize);

  return !name && !addy && !householdName && !url && !rsvp && !size;
}

function isLikelyTestRow(row) {
  const name = normalizeText(row.name).toLowerCase();
  const householdName = normalizeText(
    row.personalizedHousholdName || row.personalizedHouseholdName
  ).toLowerCase();

  return (
    name === "test name" ||
    householdName === "test household" ||
    (name.includes("test") && householdName.includes("test"))
  );
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportWarningsCsv(warnings, inputCsvPath) {
  const warningsPath = inputCsvPath.replace(/\.csv$/i, ".warnings.csv");

  const columns = [
    "type",
    "row",
    "name",
    "household",
    "startRow",
    "expectedHouseholdSize",
    "actualMembersFound",
  ];

  const lines = [
    columns.join(","),
    ...warnings.map((warning) =>
      columns.map((col) => csvEscape(warning[col])).join(",")
    ),
  ];

  fs.writeFileSync(warningsPath, lines.join("\n"), "utf8");
  return warningsPath;
}

function exportPreviewCsv(households, inputCsvPath) {
  const previewPath = inputCsvPath.replace(/\.csv$/i, ".preview.csv");

  const rows = [];

  for (const [, household] of households) {
    for (const member of household.members) {
      rows.push({
        code: household.code,
        household: household.household,
        householdSize: household.householdSize,
        uniqueUrl: household.uniqueUrl,
        allResponded: household.allResponded,
        householdRespondedAt: household.respondedAt,
        memberId: member.memberId,
        memberName: member.name,
        personalizedAddy: member.personalizedAddy,
        rsvp: member.rsvp,
        memberRespondedAt: member.respondedAt,
      });
    }
  }

  if (!rows.length) {
    fs.writeFileSync(previewPath, "", "utf8");
    return previewPath;
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
  ];

  fs.writeFileSync(previewPath, lines.join("\n"), "utf8");
  return previewPath;
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
// Group records into households using block boundaries
// ======================================================

const households = new Map();
const warnings = [];

let householdCounter = 0;
let i = 0;

while (i < records.length) {
  const row = records[i];

  if (isMeaningfullyEmptyRow(row)) {
    i++;
    continue;
  }

  if (isLikelyTestRow(row)) {
    warnings.push({
      type: "SKIPPED_TEST_ROW",
      row: i + 2,
      name: normalizeText(row.name),
      household: normalizeText(
        row.personalizedHousholdName || row.personalizedHouseholdName
      ),
      startRow: "",
      expectedHouseholdSize: "",
      actualMembersFound: "",
    });
    i++;
    continue;
  }

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

  // ------------------------------------------------------
  // CASE 1: row starts a household block
  // ------------------------------------------------------
  if (householdSize) {
    const code = existingCode || generateSixCharCode(usedCodes);
    const groupingKey = `block:${householdCounter++}:${code}`;

    const household = {
      code,
      uniqueUrl: `${BASE_URL}/?token=${code}`,
      household: householdName || name || `Household ${code}`,
      householdSize,
      allResponded: false,
      respondedAt: null,
      members: [],
    };

    for (let j = 0; j < householdSize; j++) {
      const memberRow = records[i + j];

      if (!memberRow || isMeaningfullyEmptyRow(memberRow)) {
        warnings.push({
          type: "SIZE_OVERFLOW_OR_EMPTY_MEMBER_ROW",
          row: "",
          name: "",
          household: household.household,
          startRow: i + 2,
          expectedHouseholdSize: householdSize,
          actualMembersFound: household.members.length,
        });
        break;
      }

      if (j > 0 && isLikelyTestRow(memberRow)) {
        warnings.push({
          type: "TEST_ROW_INSIDE_HOUSEHOLD_BLOCK",
          row: i + j + 2,
          name: normalizeText(memberRow.name),
          household: household.household,
          startRow: i + 2,
          expectedHouseholdSize: householdSize,
          actualMembersFound: household.members.length,
        });
        break;
      }

      const memberName = normalizeText(memberRow.name);
      const memberAddy = normalizeText(memberRow.personalizedAddress);
      const memberRsvp = normalizeRsvp(memberRow.rsvp);

      if (!memberName) {
        warnings.push({
          type: "BLANK_MEMBER_NAME",
          row: i + j + 2,
          name: "",
          household: household.household,
          startRow: i + 2,
          expectedHouseholdSize: householdSize,
          actualMembersFound: household.members.length,
        });
        continue;
      }

      household.members.push({
        memberId: "",
        name: memberName,
        personalizedAddy: memberAddy || null,
        rsvp: memberRsvp,
        respondedAt: memberRsvp ? new Date().toISOString() : null,
      });
    }

    if (household.members.length !== householdSize) {
      warnings.push({
        type: "SIZE_MISMATCH",
        row: "",
        name: "",
        household: household.household,
        startRow: i + 2,
        expectedHouseholdSize: householdSize,
        actualMembersFound: household.members.length,
      });
    }

    households.set(groupingKey, household);
    i += householdSize;
    continue;
  }

  // ------------------------------------------------------
  // CASE 2: orphan row with no household size
  // Treat as single-person household
  // ------------------------------------------------------
  if (name) {
    const code = existingCode || generateSixCharCode(usedCodes);
    const groupingKey = `single:${householdCounter++}:${code}`;

    households.set(groupingKey, {
      code,
      uniqueUrl: `${BASE_URL}/?token=${code}`,
      household: householdName || name,
      householdSize: 1,
      allResponded: false,
      respondedAt: null,
      members: [
        {
          memberId: "",
          name,
          personalizedAddy: personalizedAddy || null,
          rsvp: existingRsvp,
          respondedAt: existingRsvp ? new Date().toISOString() : null,
        },
      ],
    });

    warnings.push({
      type: "ORPHAN_ROW_TREATED_AS_SINGLE_HOUSEHOLD",
      row: i + 2,
      name,
      household: householdName || name,
      startRow: i + 2,
      expectedHouseholdSize: 1,
      actualMembersFound: 1,
    });
  }

  i++;
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
    household.members.every(
      (member) => member.rsvp === "yes" || member.rsvp === "no"
    );

  household.respondedAt = household.allResponded
    ? new Date().toISOString()
    : null;

  household.createdAt = admin.firestore.FieldValue.serverTimestamp();
  household.updatedAt = admin.firestore.FieldValue.serverTimestamp();
}

// ======================================================
// Write to Firestore / Dry Run
// ======================================================

async function run() {
  const previewPath = exportPreviewCsv(households, csvPath);
  const warningsPath = exportWarningsCsv(warnings, csvPath);

  if (isDryRun) {
    console.log("DRY RUN MODE ENABLED");
    console.log(`Would import ${households.size} household document(s) into ${COLLECTION_NAME}`);
    console.log(`Preview CSV: ${previewPath}`);
    console.log(`Warnings CSV: ${warningsPath}`);

    if (warnings.length) {
      console.log(`Warnings: ${warnings.length}`);
      for (const warning of warnings) {
        console.log(JSON.stringify(warning));
      }
    }

    return;
  }

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
  console.log(`Preview CSV: ${previewPath}`);
  console.log(`Warnings CSV: ${warningsPath}`);

  if (warnings.length) {
    console.log(`Warnings: ${warnings.length}`);
    for (const warning of warnings) {
      console.log(JSON.stringify(warning));
    }
  }
}

run().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});