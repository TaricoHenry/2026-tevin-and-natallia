# Wedding Gallery System — Architecture & Implementation Guide

## Goal
Low-cost, scalable photo gallery system where:

* Guests upload photos
* Admin reviews and approves
* Public gallery displays approved images
* Storage is handled efficiently using Cloudflare R2

---

# High-Level Architecture

```
[Guest Browser]
     ↓ (compressed upload)
[Firebase Function → Signed URL]
     ↓
[Cloudflare R2 (storage)]
     ↓
[Firestore (metadata)]
     ↓
[Jekyll (GitHub Pages) Gallery]
     ↑
[React Admin Portal]
```

---

# Tech Stack

## Frontend

* Public Gallery: Jekyll (GitHub Pages)
* Admin Portal: React

## Backend / Services

* Auth + Logic: Firebase (Functions + optional Auth)
* Database: Firestore (metadata only)
* Storage: Cloudflare R2
* CDN: Cloudflare (via custom domain)

---

# Storage Design (R2)

## Bucket Structure

```
wedding-gallery/
  pending/
    {inviteCode}/{uuid}.webp
  approved/
    {album}/{uuid}.webp
  thumbs/
    {album}/{uuid}.webp
```

## Public URL Format

```
https://photos.yoursite.com/{path}
```

---

# Firestore Schema

## Collection: `images`

```json
{
  "id": "auto",
  "objectKey": "approved/ceremony/abc.webp",
  "url": "https://photos.yoursite.com/approved/ceremony/abc.webp",
  "thumbUrl": "https://photos.yoursite.com/thumbs/ceremony/abc.webp",

  "approved": true,
  "album": "ceremony",

  "uploaderType": "guest",
  "inviteCode": "A12345",
  "guestName": "John",

  "uploadedAt": "timestamp",
  "sizeBytes": 284221,
  "width": 1600,
  "height": 1200
}
```

---

# Upload Flow

## Step-by-Step

### 1. Guest selects images

* Allow multiple files
* Enforce upload limit (recommended: 10–20 per guest)

---

### 2. Compress images in the browser before upload

Recommended targets:

* Max width: 1600–2048 px
* Format: WebP or JPEG
* Quality: 0.7–0.82
* Expected size: 200KB–800KB per image

---

### 3. Request signed upload URL

Frontend calls Firebase Function:

```
POST /generate-upload-url
```

Request:

```json
{
  "fileType": "image/webp",
  "inviteCode": "A12345"
}
```

---

### 4. Firebase Function responsibilities

* Validate invite or authentication
* Generate object key:

  ```
  pending/{inviteCode}/{uuid}.webp
  ```
* Generate R2 presigned PUT URL
* Return:

```json
{
  "uploadUrl": "...",
  "objectKey": "...",
  "publicUrl": "https://photos.yoursite.com/..."
}
```

---

### 5. Upload directly to R2 from browser

```js
await fetch(uploadUrl, {
  method: "PUT",
  body: file,
  headers: {
    "Content-Type": "image/webp"
  }
});
```

---

### 6. Save metadata

After successful upload:

```json
{
  "objectKey": "...",
  "url": "...",
  "approved": false,
  "uploadedAt": "timestamp"
}
```

---

# Admin Flow (React)

## Features

* View pending uploads
* Preview images
* Approve or reject images

## Approval Options

### Option A (simpler)

* Keep object path unchanged
* Update Firestore: `approved = true`

### Option B (cleaner)

* Move object:

  ```
  pending/... → approved/{album}/...
  ```
* Update Firestore with new path

---

# Public Gallery (Jekyll)

## Key Concept

Jekyll is static. Use JavaScript to load and render gallery data.

---

## Example Implementation

```html
<div id="gallery"></div>

<script type="module">
  const images = await fetch('/api/gallery.json').then(r => r.json());

  const gallery = document.getElementById("gallery");

  images.forEach(img => {
    const el = document.createElement("img");
    el.src = img.thumbUrl || img.url;
    el.loading = "lazy";
    gallery.appendChild(el);
  });
</script>
```

---

## Data Source Options

### Option A (recommended)

* Backend endpoint returns approved images

### Option B

* Periodically export Firestore to JSON

---

# Security

## Upload Security

* Only backend generates signed upload URLs
* URLs expire (5–15 minutes)
* Validate inviteCode before issuing URL

## R2 CORS Configuration (Required)

Allowed methods:

```
PUT, GET
```

Allowed headers:

```
Content-Type
```

---

# Cost Optimization Strategy

## Required Practices

### 1. Compress before upload

This is the primary cost reduction method

### 2. Limit uploads

* Recommended: 10–20 photos per guest

### 3. Do not store originals

Store only:

* gallery-sized image
* thumbnail

---

## Expected Storage Example

* 10,000 images × 400KB
  = ~4 GB total

R2 cost ≈ minimal monthly cost

---

# Folder Naming Convention

| Type       | Path                    |
| ---------- | ----------------------- |
| Pending    | `pending/{inviteCode}/` |
| Approved   | `approved/{album}/`     |
| Thumbnails | `thumbs/{album}/`       |

---

# Future Enhancements

* Automatic thumbnail generation
* Duplicate detection
* Album downloads (ZIP)
* Slideshow mode
* Image tagging or grouping

---

# Key Decisions Summary

| Decision        | Choice              |
| --------------- | ------------------- |
| Storage         | Cloudflare R2       |
| Metadata        | Firestore           |
| Upload method   | Signed URL (direct) |
| Public frontend | Jekyll              |
| Admin UI        | React               |
| Compression     | Client-side         |

---

# Implementation Order

1. Create R2 bucket and custom domain
2. Configure Firestore collection
3. Implement signed upload URL function
4. Add client-side image compression
5. Implement upload flow to R2
6. Save metadata to Firestore
7. Build admin approval interface
8. Build Jekyll gallery page

---

# Summary

* R2 handles file storage and delivery
* Firestore manages metadata and workflow
* Firebase Functions only generate signed URLs
* Jekyll renders images using public URLs

This design keeps the system cost-efficient, scalable, and straightforward to maintain.
