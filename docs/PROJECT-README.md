# Wedding RSVP Admin + Public API

A Firebase-backed RSVP system for managing wedding guest households and collecting guest responses.

This project includes:

- a public RSVP API for guests
- a protected admin API for household management
- a React admin dashboard
- a Firestore bulk import script for initial guest loading

---

# Table of Contents

- [1. Project Overview](#1-project-overview)
- [2. Core Business Rules](#2-core-business-rules)
- [3. Tech Stack](#3-tech-stack)
- [4. Project Structure](#4-project-structure)
- [5. System Architecture](#5-system-architecture)
- [6. Firestore Data Model](#6-firestore-data-model)
- [7. System-Managed Fields](#7-system-managed-fields)
- [8. Public API Overview](#8-public-api-overview)
- [9. Admin API Overview](#9-admin-api-overview)
- [10. React Admin Dashboard Overview](#10-react-admin-dashboard-overview)
- [11. Bulk Import Script Overview](#11-bulk-import-script-overview)
- [12. Tutorial: Run Locally](#12-tutorial-run-locally)
- [13. Local Environment Notes](#13-local-environment-notes)
- [14. Deployment Guide](#14-deployment-guide)
- [15. Frontend Handoff Notes](#15-frontend-handoff-notes)
- [16. Reference Docs](#16-reference-docs)
- [17. Recommended Future Improvements](#17-recommended-future-improvements)

---

# 1. Project Overview

This project is used to manage wedding invitations at the **household** level.

Each household has:

- a backend-generated 6-character code
- a backend-generated unique URL
- one or more household members
- RSVP responses tracked per member

The system supports two main flows:

## Guest flow
Guests use a household token/code to:

- check whether their invite exists
- retrieve their household information
- submit RSVP responses for one or more members

## Admin flow
Admins use a protected dashboard to:

- log in
- view all households
- create households
- edit households
- export data to CSV

---

# 2. Core Business Rules

These rules are important and intentional:

## Household-level storage
Each Firestore document represents **one household**, not one guest.

## RSVP is tracked per member
RSVP is not stored once at the household level.  
Instead, each member inside the household has their own RSVP value:

- `yes`
- `no`
- `null` (not yet responded)

## A household is "complete" only when all members have replied
The household field `allResponded` becomes `true` only when every member has:

- `rsvp = "yes"` or
- `rsvp = "no"`

## Critical system-managed fields
The following fields are generated and controlled by the backend only:

- `code`
- `uniqueUrl`
- `memberId`

They must **not** be manually entered or edited by users in the admin UI.

---

# 3. Tech Stack

## Backend
- Node.js
- Express
- Firebase Functions v2
- Firebase Admin SDK
- Firestore
- Joi
- CORS
- cookie-parser
- bcryptjs
- jsonwebtoken

## Frontend
- React
- Fetch API
- Cookie-based admin authentication

## Utilities
- csv-parse
- Node core modules like:
  - `fs`
  - `path`
  - `crypto`

---

# 4. Project Structure

```text
index.js              Express + Firebase Functions API
AdminDashboard.jsx    React admin dashboard
importGuests.js       Firestore CSV import script
README.md             Main project documentation
API_SPEC.md           API contract and endpoint details
````

If the frontend is split into its own app later, `AdminDashboard.jsx` should move into the frontend repo and continue talking to the same admin API.

---

# 5. System Architecture

## Backend

The backend runs as a Firebase HTTPS function and mounts an Express app.

The API is split into two route groups:

### Public routes

Prefix: `/v1`

Used by invited guests for:

* token validation
* household retrieval
* RSVP submission

### Admin routes

Prefix: `/v1/admin`

Used by authenticated admins for:

* login/logout
* household listing
* household creation
* household editing

## Authentication

Admin authentication uses:

* username/password
* JWT session token
* HTTP-only cookie named `__session`

## Persistence

Data is stored in Firestore.

Collection used:

* `InvitedGuests`

Each document ID is the household code.

---

# 6. Firestore Data Model

Collection:

```text
InvitedGuests
```

Each document represents one household.

## Example document

```json
{
  "code": "AB12CD",
  "uniqueUrl": "https://tevinandnatallia.com/?token=AB12CD",
  "household": "The Smith Family",
  "householdSize": 3,
  "allResponded": false,
  "respondedAt": null,
  "members": [
    {
      "memberId": "AB12CD_1",
      "name": "John Smith",
      "personalizedAddy": "Mr. John",
      "rsvp": null,
      "respondedAt": null
    },
    {
      "memberId": "AB12CD_2",
      "name": "Jane Smith",
      "personalizedAddy": "Mrs. Jane",
      "rsvp": "yes",
      "respondedAt": "2026-04-02T12:00:00.000Z"
    }
  ],
  "createdAt": "Firestore server timestamp",
  "updatedAt": "Firestore server timestamp"
}
```

## Field meanings

### Top-level fields

* `code`: unique 6-character household code
* `uniqueUrl`: public-facing invite URL derived from the code
* `household`: display label for the household
* `householdSize`: expected number of members in the household
* `allResponded`: whether all members have submitted an RSVP
* `respondedAt`: set when the entire household has responded
* `members`: array of household members
* `createdAt`: server timestamp for creation
* `updatedAt`: server timestamp for latest update

### Member fields

* `memberId`: system-generated member identifier
* `name`: guest name
* `personalizedAddy`: optional greeting or formal address
* `rsvp`: `yes`, `no`, or `null`
* `respondedAt`: timestamp when that member’s RSVP was recorded

---

# 7. System-Managed Fields

These fields are backend-owned and should never be user-editable.

## 7.1 Household code

Rules:

* always 6 characters
* uppercase alphanumeric
* generated automatically by the backend
* immutable after creation
* used as the Firestore document ID

## 7.2 Unique URL

Rules:

* always derived from the household code
* format:

```text
https://tevinandnatallia.com/?token={CODE}
```

* immutable after creation

## 7.3 Member ID

Rules:

* generated automatically by the backend
* format:

```text
{CODE}_{index}
```

Examples:

```text
AB12CD_1
AB12CD_2
AB12CD_3
```

Existing member IDs are preserved on update.
Newly added members receive generated IDs automatically.

---

# 8. Public API Overview

Base public path:

```text
/v1
```

Public endpoints:

* `GET /v1/ready`
* `GET /v1/token/:token/status`
* `GET /v1/token/:token`
* `POST /v1/token/:token/reply`

These routes do **not** require admin authentication.

---

# 9. Admin API Overview

Base admin path:

```text
/v1/admin
```

Admin endpoints:

* `POST /v1/admin/login`
* `POST /v1/admin/logout`
* `GET /v1/admin/households`
* `POST /v1/admin/households`
* `PUT /v1/admin/households/:code`

These routes require an authenticated admin cookie after login, except `login`.

---

# 10. React Admin Dashboard Overview

The React dashboard is designed for simple household editing and client-friendly management.

## Current behavior

The dashboard:

* authenticates against `/v1/admin/login`
* fetches households from `/v1/admin/households`
* opens an add/edit modal
* allows editing:

  * household name
  * household size
  * member names
  * personalized addresses
  * RSVP values
* exports rows as CSV

## Important UI behavior

The dashboard intentionally treats these values as read-only:

* `code`
* `uniqueUrl`
* `memberId`

### Create mode

When adding a new household:

* code is not entered manually
* unique URL is not entered manually
* member IDs are not entered manually
* all system IDs are generated on save

### Edit mode

When editing a household:

* code is visible but read-only
* unique URL is visible but read-only
* member IDs are visible but read-only

---

# 11. Bulk Import Script Overview

The import script loads household data into Firestore from a CSV file.

## Script responsibilities

The script:

1. reads the CSV
2. groups rows into households
3. reuses a code from `Unique URL` if present
4. otherwise generates a unique 6-character code
5. generates member IDs
6. computes `allResponded`
7. writes household documents to Firestore

## Expected CSV headers

```text
name, personalizedAddress, personalizedHousholdName, housholdSize, rsvp, Unique URL
```

The script is tolerant of the existing sheet spelling variants such as:

* `personalizedHousholdName`
* `housholdSize`

## Example usage

```bash
node importGuests.js ./csv/guestList.csv
```

---

# 12. Tutorial: Run Locally

This section is meant for the next frontend/backend developer taking over.

## 12.1 Prerequisites

Install these first:

* Node.js 18 or later
* npm
* Firebase CLI
* access to the Firebase project
* a Firestore-enabled Firebase project

Check installed versions:

```bash
node -v
npm -v
firebase --version
```

## 12.2 Install dependencies

From the project root:

```bash
npm install
```

Typical dependencies expected:

```bash
npm install express cors joi cookie-parser bcryptjs jsonwebtoken firebase-admin firebase-functions csv-parse
```

If the React admin dashboard lives in a separate frontend folder/app, install frontend dependencies there as well.

## 12.3 Log into Firebase

```bash
firebase login
```

## 12.4 Select the correct Firebase project

```bash
firebase use --add
```

Choose the correct Firebase project and alias it.

## 12.5 Set up admin credentials for local development

The backend code supports environment-based admin config.

Set these before running locally:

```bash
export ADMIN_USERNAME=clientadmin
export ADMIN_PASSWORD_HASH='YOUR_BCRYPT_HASH'
export ADMIN_JWT_SECRET='YOUR_LONG_RANDOM_SECRET'
```

### Generate a bcrypt hash quickly

You can generate one with a short Node command:

```bash
node -e "const bcrypt=require('bcryptjs'); console.log(bcrypt.hashSync('your-password', 10))"
```

Copy the output into `ADMIN_PASSWORD_HASH`.

## 12.6 Start local development

There are two parts:

### Option A: Backend only

Run Firebase emulators or your local server setup, depending on your project config.

Typical Firebase emulator flow:

```bash
firebase emulators:start
```

If you are exposing Express through Firebase Functions only, this is the preferred local path.

### Option B: Frontend dev server

If your React app uses Vite:

```bash
npm run dev
```

Make sure your frontend proxies API calls correctly to the backend/emulator.

## 12.7 Test the health endpoint

Once running locally, test:

```bash
GET /v1/ready
```

Expected response:

```json
{
  "isSuccess": true,
  "message": "API is ready to accept requests"
}
```

## 12.8 Test admin login

Use the dashboard login form or a REST client.

After login, verify the browser stores the `__session` cookie.

## 12.9 Test household CRUD

After login:

* load households
* create a household
* edit a household
* verify:

  * code did not become editable
  * unique URL stayed derived from code
  * member IDs stayed preserved on edit

---

# 13. Local Environment Notes

## Cookie behavior

Admin auth uses an HTTP-only cookie:

```text
__session
```

Cookie settings in the backend:

* `httpOnly: true`
* `secure: true`
* `sameSite: "lax"`
* `path: "/"`
* 8 hour expiration

## Important local caveat

Because `secure: true` is enabled, cookies may not persist correctly in plain HTTP local development.

If login works in production but not locally, this is one of the first things to check.

### Common local solutions

* use an HTTPS local setup
* use emulator tooling that supports cookies correctly
* temporarily adjust local cookie behavior for development only

Example pattern:

```js
const isProduction = process.env.NODE_ENV === "production";

res.cookie(ADMIN_COOKIE_NAME, token, {
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax",
  path: "/",
  maxAge: 8 * 60 * 60 * 1000,
});
```

If you do this, keep production secure.

## CORS

Allowed origins are currently controlled in `index.js`.

If the frontend moves to a new origin, update the allowed origins list.

---

# 14. Deployment Guide

This section covers the typical deployment process for handoff.

## 14.1 Before deploying

Confirm the following:

* Firebase project is correct
* Firestore is enabled
* required environment secrets are ready
* frontend domain is added to CORS allowlist
* production admin credentials are secure
* `ADMIN_JWT_SECRET` is long and random

## 14.2 Production secrets

Do not rely on hardcoded fallbacks in production.

At minimum, configure:

* `ADMIN_USERNAME`
* `ADMIN_PASSWORD_HASH`
* `ADMIN_JWT_SECRET`

Use Firebase environment/secrets management for production.

## 14.3 Deploy backend

Typical deployment command:

```bash
firebase deploy --only functions
```

If the function name is `api`, verify the deployed route and any rewrites.

## 14.4 Deploy frontend

Deploy the frontend/admin app using your chosen host.

Common options:

* Firebase Hosting
* Vercel
* Netlify
* custom hosting setup

## 14.5 Configure production domain behavior

After backend and frontend are live, verify:

* CORS allows the frontend origin
* login sets the cookie successfully
* cookie is sent with admin API requests
* public RSVP URLs resolve correctly
* household code URLs route properly

## 14.6 Post-deploy smoke test

Run this quick checklist:

### Public checks

* `/v1/ready` works
* valid token loads household
* invalid token returns not found
* RSVP submission works

### Admin checks

* login works
* logout works
* household list loads
* new household creates successfully
* edit preserves:

  * code
  * unique URL
  * member IDs

---

# 15. Frontend Handoff Notes

This section is specifically for the frontend developer taking over.

## What the frontend must never do

Do **not** allow users to manually set or edit:

* household code
* unique URL
* member ID

These are backend-owned fields.

## What the frontend is allowed to edit

The admin UI may edit:

* `household`
* `householdSize`
* `members[].name`
* `members[].personalizedAddy`
* `members[].rsvp`

## Create payload shape

When creating a household, send only:

```json
{
  "household": "The Smith Family",
  "householdSize": 2,
  "members": [
    {
      "name": "John Smith",
      "personalizedAddy": "Mr. John",
      "rsvp": null
    },
    {
      "name": "Jane Smith",
      "personalizedAddy": "Mrs. Jane",
      "rsvp": null
    }
  ]
}
```

Do not send:

* `code`
* `uniqueUrl`
* `memberId`

## Update payload shape

When updating a household, send the same editable structure only:

```json
{
  "household": "The Smith Family",
  "householdSize": 2,
  "members": [
    {
      "name": "John Smith",
      "personalizedAddy": "Mr. John",
      "rsvp": "yes"
    },
    {
      "name": "Jane Smith",
      "personalizedAddy": "Mrs. Jane",
      "rsvp": "no"
    }
  ]
}
```

The backend is responsible for preserving immutable identifiers.

## Search and display tips

Good searchable fields:

* household name
* code
* unique URL
* member name
* member RSVP
* member ID for admin debugging only

## Best next UI improvements

Recommended frontend improvements:

* replace free-text RSVP input with a dropdown
* add validation messages inline
* add loading state inside modal save button
* add copy-to-clipboard for unique URL
* add pagination or virtualized table for large guest lists

---

# 16. Reference Docs

## Internal project references

* `index.js` — backend API and business rules
* `AdminDashboard.jsx` — admin UI
* `importGuests.js` — CSV import utility
* `API_SPEC.md` — full endpoint definitions

## External references

* Firebase Functions docs
* Firebase Admin SDK docs
* Firestore docs
* Express docs
* Joi validation docs
* React docs
* bcryptjs docs
* jsonwebtoken docs

Suggested reading order for a new developer:

1. `README.md`
2. `API_SPEC.md`
3. `index.js`
4. `AdminDashboard.jsx`
5. `importGuests.js`

---

# 17. Recommended Future Improvements

## Backend

1. Move admin secrets fully into Firebase secrets/runtime config
2. Add structured logging
3. Add delete-household endpoint if needed
4. Add request/response tests
5. Improve member ID preservation when rows are reordered
6. Add stronger duplicate detection rules
7. Add pagination for admin household listing

## Frontend

1. Replace RSVP text input with select
2. Add toast notifications
3. Add optimistic refresh after save
4. Add copy link button for unique URL
5. Add filters for complete/incomplete households
6. Add mobile-friendly admin layout

## Data / import

1. Add dry-run mode for import script
2. Add duplicate row reporting
3. Add CSV validation summary before write
4. Add import rollback strategy for large batches