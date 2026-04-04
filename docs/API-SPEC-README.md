
# API Specification README FILE
Wedding RSVP Admin + Public API

This document defines the current API contract for the wedding RSVP system.

---

# Table of Contents

- [1. General Conventions](#1-general-conventions)
- [2. Authentication](#2-authentication)
- [3. Public Endpoints](#3-public-endpoints)
- [4. Admin Endpoints](#4-admin-endpoints)
- [5. Validation Rules](#5-validation-rules)
- [6. Firestore Mapping Notes](#6-firestore-mapping-notes)
- [7. Frontend Integration Notes](#7-frontend-integration-notes)
- [8. Error Handling Notes](#8-error-handling-notes)

---

# 1. General Conventions

## Base paths

### Public API
```text
/v1
````

### Admin API

```text
/v1/admin
```

## Content type

Requests and responses use JSON unless otherwise noted.

```http
Content-Type: application/json
```

## Standard success shape

Typical success responses follow this pattern:

```json
{
  "isSuccess": true,
  "message": "Some success message"
}
```

## Standard error shape

Typical error responses follow this pattern:

```json
{
  "isSuccess": false,
  "message": "Some error message"
}
```

Some validation errors also include:

```json
{
  "isSuccess": false,
  "message": "Validation error",
  "errors": [
    {
      "path": "members.0.name",
      "message": "name is required"
    }
  ]
}
```

---

# 2. Authentication

## Admin auth model

Admin authentication is cookie-based.

### Login flow

1. Client posts username/password to:

   * `POST /v1/admin/login`
2. Server verifies credentials
3. Server returns a JWT in an HTTP-only cookie:

   * `__session`
4. Browser automatically sends this cookie with future admin requests

### Logout flow

1. Client posts to:

   * `POST /v1/admin/logout`
2. Server clears the cookie

## Auth requirements

The following admin endpoints require a valid admin session cookie:

* `GET /v1/admin/households`
* `POST /v1/admin/households`
* `PUT /v1/admin/households/:code`

If missing or invalid, the API returns:

```json
{
  "isSuccess": false,
  "message": "Unauthorized"
}
```

with HTTP status:

```text
401 Unauthorized
```

---

# 3. Public Endpoints

## 3.1 Health check

### Endpoint

```http
GET /v1/ready
```

### Description

Confirms the API is available.

### Auth

None

### Success response

```json
{
  "isSuccess": true,
  "message": "API is ready to accept requests"
}
```

### Status codes

* `200 OK`

---

## 3.2 Check token status

### Endpoint

```http
GET /v1/token/:token/status
```

### Description

Checks whether a household token:

* exists
* is valid
* has already been fully used

A token is considered used only when **all members** in the household have responded.

### Path params

| Name    | Type   | Required | Description    |
| ------- | ------ | -------: | -------------- |
| `token` | string |      yes | Household code |

### Auth

None

### Success response: valid and unused

```json
{
  "isSuccess": true,
  "token": "AB12CD",
  "valid": true,
  "used": false,
  "message": "Token is valid"
}
```

### Success response: valid but fully used

```json
{
  "isSuccess": true,
  "token": "AB12CD",
  "valid": true,
  "used": true,
  "message": "All household members have already responded",
  "url": "https://tevinandnatallia.com/"
}
```

### Error response: token not found

```json
{
  "isSuccess": false,
  "token": "BAD123",
  "valid": false,
  "used": false,
  "message": "Guest does not exist"
}
```

### Status codes

* `200 OK`
* `404 Not Found`
* `500 Internal Server Error`

---

## 3.3 Get household by token

### Endpoint

```http
GET /v1/token/:token
```

### Description

Returns the household record for a valid token.

### Path params

| Name    | Type   | Required | Description    |
| ------- | ------ | -------: | -------------- |
| `token` | string |      yes | Household code |

### Auth

None

### Success response

```json
{
  "isSuccess": true,
  "token": "AB12CD",
  "household": "The Smith Family",
  "householdSize": 2,
  "allResponded": false,
  "members": [
    {
      "memberId": "AB12CD_1",
      "name": "John Smith",
      "personalizedAddy": "Mr. John",
      "rsvp": null
    },
    {
      "memberId": "AB12CD_2",
      "name": "Jane Smith",
      "personalizedAddy": "Mrs. Jane",
      "rsvp": null
    }
  ]
}
```

### Error response: token not found

```json
{
  "isSuccess": false,
  "token": "BAD123",
  "message": "guest does not exist"
}
```

### Status codes

* `200 OK`
* `404 Not Found`
* `500 Internal Server Error`

---

## 3.4 Submit RSVP responses

### Endpoint

```http
POST /v1/token/:token/reply
```

### Description

Submits RSVP responses for one or more members in a household.

The request updates members by `memberId`.

### Path params

| Name    | Type   | Required | Description    |
| ------- | ------ | -------: | -------------- |
| `token` | string |      yes | Household code |

### Auth

None

### Request body

```json
{
  "responses": [
    {
      "memberId": "AB12CD_1",
      "rsvp": "yes"
    },
    {
      "memberId": "AB12CD_2",
      "rsvp": "no"
    }
  ]
}
```

### Request field rules

| Field                  | Type   | Required | Allowed values  |
| ---------------------- | ------ | -------: | --------------- |
| `responses`            | array  |      yes | at least 1 item |
| `responses[].memberId` | string |      yes | non-empty       |
| `responses[].rsvp`     | string |      yes | `yes`, `no`     |

### Success response

```json
{
  "isSuccess": true,
  "token": "AB12CD",
  "allResponded": true,
  "message": "RSVP responses recorded successfully"
}
```

### Error response: token not found

```json
{
  "isSuccess": false,
  "token": "BAD123",
  "valid": false,
  "used": false,
  "message": "Guest does not exist"
}
```

### Conflict response: already fully used

```json
{
  "isSuccess": true,
  "token": "AB12CD",
  "valid": true,
  "used": true,
  "message": "All household members have already responded",
  "url": "https://tevinandnatallia.com/"
}
```

### Validation error example

```json
{
  "isSuccess": false,
  "message": "Validation error",
  "errors": [
    {
      "path": "responses.0.rsvp",
      "message": "rsvp value can only be yes or no"
    }
  ]
}
```

### Status codes

* `200 OK`
* `400 Bad Request`
* `404 Not Found`
* `409 Conflict`
* `500 Internal Server Error`

---

# 4. Admin Endpoints

## 4.1 Admin login

### Endpoint

```http
POST /v1/admin/login
```

### Description

Authenticates an admin and issues a session cookie.

### Auth

None

### Request body

```json
{
  "username": "clientadmin",
  "password": "your-password"
}
```

### Request field rules

| Field      | Type   | Required |
| ---------- | ------ | -------: |
| `username` | string |      yes |
| `password` | string |      yes |

### Success response

```json
{
  "isSuccess": true,
  "message": "Login successful"
}
```

### Error response

```json
{
  "isSuccess": false,
  "message": "Invalid credentials"
}
```

### Status codes

* `200 OK`
* `400 Bad Request`
* `401 Unauthorized`
* `500 Internal Server Error`

---

## 4.2 Admin logout

### Endpoint

```http
POST /v1/admin/logout
```

### Description

Clears the admin session cookie.

### Auth

Usually called while logged in, but does not require separate body data.

### Success response

```json
{
  "isSuccess": true,
  "message": "Logout successful"
}
```

### Status codes

* `200 OK`

---

## 4.3 List households

### Endpoint

```http
GET /v1/admin/households
```

### Description

Returns all household documents for the admin dashboard.

### Auth

Required

### Success response

```json
{
  "isSuccess": true,
  "households": [
    {
      "code": "AB12CD",
      "uniqueUrl": "https://tevinandnatallia.com/?token=AB12CD",
      "household": "The Smith Family",
      "householdSize": 2,
      "allResponded": false,
      "members": [
        {
          "memberId": "AB12CD_1",
          "name": "John Smith",
          "personalizedAddy": "Mr. John",
          "rsvp": null
        },
        {
          "memberId": "AB12CD_2",
          "name": "Jane Smith",
          "personalizedAddy": "Mrs. Jane",
          "rsvp": "yes"
        }
      ]
    }
  ]
}
```

### Status codes

* `200 OK`
* `401 Unauthorized`
* `500 Internal Server Error`

---

## 4.4 Create household

### Endpoint

```http
POST /v1/admin/households
```

### Description

Creates a new household.

### Important rules

The client must **not** send:

* `code`
* `uniqueUrl`
* `memberId`

These are generated by the backend.

### Auth

Required

### Request body

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

### Request field rules

| Field                        | Type        | Required | Notes                  |
| ---------------------------- | ----------- | -------: | ---------------------- |
| `household`                  | string      |      yes | trimmed                |
| `householdSize`              | number      |      yes | integer, min 1         |
| `members`                    | array       |      yes | minimum 1 item         |
| `members[].name`             | string      |      yes | trimmed                |
| `members[].personalizedAddy` | string/null |       no | optional               |
| `members[].rsvp`             | string/null |       no | `yes`, `no`, or `null` |

### Success response

```json
{
  "isSuccess": true,
  "message": "Household created successfully"
}
```

### Validation error example

```json
{
  "isSuccess": false,
  "message": "Validation error",
  "errors": [
    {
      "path": "members.0.name",
      "message": "members.0.name is required"
    }
  ]
}
```

### Status codes

* `201 Created`
* `400 Bad Request`
* `401 Unauthorized`
* `500 Internal Server Error`

---

## 4.5 Update household

### Endpoint

```http
PUT /v1/admin/households/:code
```

### Description

Updates an existing household.

### Important rules

* household code is immutable
* unique URL is immutable
* existing member IDs are preserved by the backend
* new member IDs are generated by the backend for newly added rows

### Path params

| Name   | Type   | Required | Description             |
| ------ | ------ | -------: | ----------------------- |
| `code` | string |      yes | Existing household code |

### Auth

Required

### Request body

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

### Success response

```json
{
  "isSuccess": true,
  "message": "Household updated successfully"
}
```

### Error response: not found

```json
{
  "isSuccess": false,
  "message": "Household not found"
}
```

### Status codes

* `200 OK`
* `400 Bad Request`
* `401 Unauthorized`
* `404 Not Found`
* `500 Internal Server Error`

---

# 5. Validation Rules

## Public RSVP schema

```json
{
  "responses": [
    {
      "memberId": "AB12CD_1",
      "rsvp": "yes"
    }
  ]
}
```

Rules:

* `responses` must be an array
* must contain at least 1 item
* each item must contain:

  * `memberId`
  * `rsvp`
* `rsvp` must be either:

  * `yes`
  * `no`

## Admin household schema

```json
{
  "household": "The Smith Family",
  "householdSize": 2,
  "members": [
    {
      "name": "John Smith",
      "personalizedAddy": "Mr. John",
      "rsvp": null
    }
  ]
}
```

Rules:

* `household` is required
* `householdSize` is required
* `members` must contain at least one member
* each member must contain:

  * `name`
* optional:

  * `personalizedAddy`
  * `rsvp`

Unknown fields are stripped by Joi validation.

---

# 6. Firestore Mapping Notes

## Collection

```text
InvitedGuests
```

## Document ID

The Firestore document ID equals the household code.

Example:

```text
InvitedGuests/AB12CD
```

## Household creation behavior

When a household is created:

* backend generates code
* backend generates unique URL
* backend generates member IDs
* backend sets timestamps

## Household update behavior

When a household is updated:

* code stays the same
* unique URL stays derived from code
* existing member IDs remain preserved
* new members get generated IDs
* updated timestamp changes

---

# 7. Frontend Integration Notes

## Required fetch option for admin routes

Because auth is cookie-based, frontend requests must include credentials.

Example:

```js
fetch("/v1/admin/households", {
  method: "GET",
  credentials: "include"
});
```

## Admin login example

```js
fetch("/v1/admin/login", {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    username: "clientadmin",
    password: "your-password"
  })
});
```

## Admin create household example

```js
fetch("/v1/admin/households", {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    household: "The Smith Family",
    householdSize: 2,
    members: [
      {
        name: "John Smith",
        personalizedAddy: "Mr. John",
        rsvp: null
      },
      {
        name: "Jane Smith",
        personalizedAddy: "Mrs. Jane",
        rsvp: null
      }
    ]
  })
});
```

## Public RSVP submit example

```js
fetch("/v1/token/AB12CD/reply", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    responses: [
      {
        memberId: "AB12CD_1",
        rsvp: "yes"
      },
      {
        memberId: "AB12CD_2",
        rsvp: "no"
      }
    ]
  })
});
```

---

# 8. Error Handling Notes

## Common admin error

### Unauthorized

Usually means:

* not logged in
* cookie not stored
* cookie not sent
* cookie rejected because of local `secure: true`
* invalid/expired JWT

Response:

```json
{
  "isSuccess": false,
  "message": "Unauthorized"
}
```

Status:

```text
401 Unauthorized
```

## Common validation error

When request bodies do not match Joi schemas:

```json
{
  "isSuccess": false,
  "message": "Validation error",
  "errors": [
    {
      "path": "members.0.name",
      "message": "name is required"
    }
  ]
}
```

Status:

```text
400 Bad Request
```

## Common not-found errors

### Missing token

```json
{
  "isSuccess": false,
  "message": "Guest does not exist"
}
```

### Missing household on admin update

```json
{
  "isSuccess": false,
  "message": "Household not found"
}
```

## Internal server error

Generic response:

```json
{
  "isSuccess": false,
  "message": "Internal server error"
}
```

Status:

```text
500 Internal Server Error
```