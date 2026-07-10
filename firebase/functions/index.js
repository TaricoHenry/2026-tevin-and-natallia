// Express application set up
import express from "express";
const app = express();
const router = express.Router();
const adminRouter = express.Router();

import cors from "cors";

// APi validation library
import Joi from "joi";


// Admin auth helpers
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";


//Firebase and firestore set-up
import admin from "firebase-admin"; //import firbase sdk
import { onRequest } from "firebase-functions/v2/https"; //using firbase function handler for http requests
import { getFirestore, FieldValue } from "firebase-admin/firestore"; //importing firebase databse tools
import crypto from "crypto";

// Cloudflare R2 upload helpers. R2 is S3-compatible, so we use AWS SDK v3.
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

admin.initializeApp();
const db = getFirestore();

// Declaring global collection for guest RSVP / invitation data
const invitedGuestsCollection = db.collection("InvitedGuests");

// Declaring global collection for wedding gallery photo metadata.
// Actual image files live in Firebase Storage / Cloud Storage.
const photosCollection = db.collection("Photos");


//Setting up API spec validation
// Updated functionality:
// RSVP is now submitted per member inside a household instead of a single RSVP value
const rsvpRequest = Joi.object({
  responses: Joi.array()
    .items(
      Joi.object({
        memberId: Joi.string()
          .trim()
          .required()
          .messages({
            "string.empty": "memberId is required",
          }),
        rsvp: Joi.string()
          .valid("yes", "no")
          .required()
          .messages({
            "any.only": "rsvp value can only be yes or no",
            "string.empty": "rsvp is required",
          }),
      })
    )
    .min(1)
    .required()
    .messages({
      "array.min": "at least one response is required",
    }),
});

// Admin login validation
const adminLoginRequest = Joi.object({
  username: Joi.string().trim().required(),
  password: Joi.string().required(),
});

// Admin household create/update validation
// IMPORTANT CHANGE:
// - code is NO LONGER accepted from the client
// - uniqueUrl is NO LONGER accepted from the client
// - memberId is NO LONGER accepted from the client
//
// These values are system-generated only.
const adminHouseholdRequest = Joi.object({
  household: Joi.string().trim().required(),
  householdSize: Joi.number().integer().min(1).required(),
  members: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().trim().required(),
        personalizedAddy: Joi.string().allow("", null),
        rsvp: Joi.string().valid("yes", "no").allow(null),
      })
    )
    .min(1)
    .required(),
});

// Public/admin photo id validation.
// Keeps route params predictable and avoids accidental invalid Firestore doc paths.
const photoIdRequest = Joi.object({
  photoId: Joi.string()
    .trim()
    .pattern(/^[A-Za-z0-9_-]{1,128}$/)
    .required()
    .messages({
      "string.pattern.base": "photoId may only contain letters, numbers, underscores, and dashes",
    }),
});

const allowedImageTypes = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
];

const maxPhotoUploadBytes = Number(process.env.MAX_PHOTO_UPLOAD_BYTES || 15 * 1024 * 1024);

const basePhotoUploadRequest = {
  fileName: Joi.string().trim().max(240).required(),
  contentType: Joi.string()
    .trim()
    .lowercase()
    .valid(...allowedImageTypes)
    .required(),
  altText: Joi.string().trim().allow("", null),
  album: Joi.string()
    .trim()
    .lowercase()
    .pattern(/^[a-z0-9_-]{1,64}$/)
    .default("general")
    .messages({
      "string.pattern.base":
        "album may only contain lowercase letters, numbers, underscores, and dashes",
    }),
  sizeBytes: Joi.number().integer().min(1).max(maxPhotoUploadBytes).required(),
  width: Joi.number().integer().min(1).max(30000).allow(null),
  height: Joi.number().integer().min(1).max(30000).allow(null),
  createThumbnail: Joi.boolean().default(true),
  sortOrder: Joi.number().integer().allow(null),
};

// Guest upload request.
// inviteCode is optional so the public QR-code upload page can accept photos
// without tying every upload to a specific invitation.
// When inviteCode is supplied, the upload route validates it against InvitedGuests.
const guestPhotoUploadRequest = Joi.object({
  ...basePhotoUploadRequest,
  inviteCode: Joi.string().trim().allow("", null),
  guestName: Joi.string().trim().max(120).allow("", null),
});

// Admin upload request.
// Admin uploads can be approved immediately by default.
const adminPhotoUploadRequest = Joi.object({
  ...basePhotoUploadRequest,
  approved: Joi.boolean().default(true),
  guestName: Joi.string().trim().max(120).allow("", null),
  inviteCode: Joi.string().trim().allow("", null),
});

// Manual admin metadata create request.
// Use this when the image already exists somewhere public and you only need to store metadata.
const adminPhotoRequest = Joi.object({
  id: Joi.string()
    .trim()
    .pattern(/^[A-Za-z0-9_-]{1,128}$/)
    .allow("", null),

  url: Joi.string()
    .trim()
    .uri({ scheme: ["http", "https"] })
    .required()
    .messages({
      "string.empty": "url is required",
      "string.uri": "url must be a valid http or https URL",
      "any.required": "url is required",
    }),

  thumbUrl: Joi.string()
    .trim()
    .uri({ scheme: ["http", "https"] })
    .allow("", null)
    .messages({
      "string.uri": "thumbUrl must be a valid http or https URL",
    }),

  altText: Joi.string().trim().allow("", null),
  approved: Joi.boolean().default(false),
  album: Joi.string().trim().lowercase().allow("", null),

  uploaderType: Joi.string().trim().valid("guest", "admin", "system").default("admin"),
  inviteCode: Joi.string().trim().allow("", null),
  guestName: Joi.string().trim().allow("", null),

  uploadedAt: Joi.date().iso().allow(null),
  sizeBytes: Joi.number().integer().min(0).allow(null),
  width: Joi.number().integer().min(0).allow(null),
  height: Joi.number().integer().min(0).allow(null),
  sortOrder: Joi.number().integer().allow(null),
});

const adminPhotoUpdateRequest = Joi.object({
  url: Joi.string().trim().uri({ scheme: ["http", "https"] }),
  thumbUrl: Joi.string().trim().uri({ scheme: ["http", "https"] }).allow("", null),
  altText: Joi.string().trim().allow("", null),
  approved: Joi.boolean(),
  album: Joi.string().trim().lowercase().allow("", null),
  uploaderType: Joi.string().trim().valid("guest", "admin", "system"),
  inviteCode: Joi.string().trim().allow("", null),
  guestName: Joi.string().trim().allow("", null),
  uploadedAt: Joi.date().iso().allow(null),
  sizeBytes: Joi.number().integer().min(0).allow(null),
  width: Joi.number().integer().min(0).allow(null),
  height: Joi.number().integer().min(0).allow(null),
  sortOrder: Joi.number().integer().allow(null),
}).min(1);

const guestPhotoCompleteRequest = Joi.object({
  uploadToken: Joi.string().trim().required(),
  thumbUploaded: Joi.boolean().default(false),
  sizeBytes: Joi.number().integer().min(0).max(maxPhotoUploadBytes).allow(null),
  width: Joi.number().integer().min(1).max(30000).allow(null),
  height: Joi.number().integer().min(1).max(30000).allow(null),
});

const adminPhotoCompleteRequest = Joi.object({
  thumbUploaded: Joi.boolean().default(false),
  approved: Joi.boolean(),
  sizeBytes: Joi.number().integer().min(0).max(maxPhotoUploadBytes).allow(null),
  width: Joi.number().integer().min(1).max(30000).allow(null),
  height: Joi.number().integer().min(1).max(30000).allow(null),
});

// ===================================
// API and Admin config
// ===================================
// Protect admin dashboard with username/password.
// Successful login returns an httpOnly cookie session.
//
// IMPORTANT:
// In production these should come from environment variables
// or Firebase runtime config, not be hardcoded in the file.
const apiVersion = "/v1";
const defaultPageUrl = "https://tevinandnatallia.com/";
const ADMIN_COOKIE_NAME = "__session";
const ADMIN_BASE_PATH = "/admin";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "clientadmin";
const ADMIN_PASSWORD_HASH =
  process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync("change-this-password", 10);
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "change-this-secret";
const uploadTokenPepper = process.env.UPLOAD_TOKEN_PEPPER || ADMIN_JWT_SECRET;

// ===================================
// Centralized response message constants
// ===================================
// Using constants prevents bugs caused by typos
// and avoids relying on fragile string comparisons
export const TOKEN_MESSAGES = {
  NOT_FOUND: "Guest does not exist",
  USED: "All household members have already responded",
  VALID: "Token is valid",
};

// =======================
// Global Middleware Setup
// =======================

// Limit incoming JSON payload size for security (prevents large payload abuse)
app.use(express.json({ limit: "100kb" }));

// Parse cookies for admin session handling
app.use(cookieParser());

// ===================================
// CORS CONFIGURATION (ADDED FOR ADMIN DASHBOARD)
// ===================================
// This enables cross-origin requests from your local React app
// AND allows cookies (required for admin login session)

const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://tevinandnatallia.com",
  "https://tevin-wedding.web.app",
];

// ===================================
// CORS CONFIGURATION (FIXED)
// ===================================
// IMPORTANT:
// We create ONE shared corsMiddleware and use it for BOTH:
// - normal requests
// - preflight (OPTIONS) requests

const corsMiddleware = cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
});

app.use(corsMiddleware);

// ===================================
// FIX: HANDLE PREFLIGHT USING SAME MIDDLEWARE
// ===================================
// This ensures OPTIONS uses credentials: true as well
app.options(/.*/, corsMiddleware);

// Log every incoming request (useful for debugging and monitoring)
app.use((req, res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
});

// ========================================
// Validation Middleware (Joi)
// ========================================
/**
 * Creates reusable validation middleware.
 *
 * Why:
 * - Ensures only valid data reaches your route handlers
 * - Automatically strips unwanted fields
 * - Returns consistent error responses
 *
 * @param {Object} schema - Joi schema to validate against
 * @param {string} property - req property to validate (body, params, query)
 * @returns {Function} Express middleware
 */
export const validateRequest = (schema, property = "body") => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false, // return ALL validation errors
      stripUnknown: true, // remove fields not defined in schema
      errors: {
        wrap: {
          label: false, // cleaner error messages (no quotes)
        },
      },
    });

    // If validation succeeds, overwrite with sanitized data
    if (!error) {
      req[property] = value;
      return next();
    }

    // Format Joi errors into a consistent API structure
    const errorDetails = error.details.map((detail) => ({
      path: detail.path.join("."),
      message: detail.message,
    }));

    return res.status(400).json({
      isSuccess: false,
      message: "Validation error",
      errors: errorDetails,
    });
  };
};
// ======================================
// End Validation Middleware
// ======================================

// ===================================
// Shared Helper Functions
// ===================================

// Build a full RSVP URL from a 6 character code
function buildUniqueUrl(code) {
  return `https://tevinandnatallia.com/?token=${code}`;
}

// Normalize code to 6 uppercase alphanumeric characters
function normalizeCode(code) {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

// Generate a unique 6 character code
// IMPORTANT:
// - This is server-side only
// - Users/admin UI do not enter this manually
function generateRandomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => {
    const i = crypto.randomInt(0, chars.length);
    return chars[i];
  }).join("");
}

// Generate a unique household code by checking Firestore
async function generateUniqueHouseholdCode(firebaseCollection) {
  let code = "";
  let exists = true;

  while (exists) {
    code = generateRandomCode();
    const snapshot = await firebaseCollection.doc(code).get();
    exists = snapshot.exists;
  }

  return code;
}

// Determine whether every member in a household has responded
function calculateAllResponded(members = []) {
  return (
    members.length > 0 &&
    members.every((member) => member.rsvp === "yes" || member.rsvp === "no")
  );
}


// ===================================
// Shared photo / Cloudflare R2 helpers
// ===================================

let r2Client;

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getR2Config() {
  const accountId = getRequiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const accessKeyId = getRequiredEnv("CLOUDFLARE_R2_ACCESS_KEY_ID");
  const secretAccessKey = getRequiredEnv("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  const bucket = getRequiredEnv("CLOUDFLARE_R2_BUCKET");
  const publicBaseUrl = getRequiredEnv("CLOUDFLARE_R2_PUBLIC_BASE_URL");
  const endpoint =
    process.env.CLOUDFLARE_R2_ENDPOINT ||
    `https://${accountId}.r2.cloudflarestorage.com`;
  const presignedExpiresSeconds = Math.min(
    Math.max(Number(process.env.CLOUDFLARE_R2_PRESIGNED_EXPIRES_SECONDS || 15 * 60), 60),
    60 * 60
  );

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl,
    endpoint,
    presignedExpiresSeconds,
  };
}

function getR2Client() {
  if (r2Client) return r2Client;

  const config = getR2Config();

  r2Client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return r2Client;
}

function cleanAlbum(album) {
  return String(album || "general")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "general";
}

function getExtensionForImage(fileName, contentType) {
  const extensionFromName = String(fileName || "")
    .split(".")
    .pop()
    ?.toLowerCase();

  const allowedExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"]);

  if (extensionFromName && allowedExtensions.has(extensionFromName)) {
    return extensionFromName === "jpeg" ? "jpg" : extensionFromName;
  }

  const contentTypeMap = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
  };

  return contentTypeMap[contentType] || "jpg";
}

function createUploadToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashUploadToken(uploadToken) {
  return crypto
    .createHmac("sha256", uploadTokenPepper)
    .update(String(uploadToken || ""))
    .digest("hex");
}

function buildR2ObjectKey({ uploaderType, album, photoId, extension, inviteCode, variant }) {
  const cleanVariant = variant === "thumb" ? "thumbs" : "approved";
  const cleanInviteCode = inviteCode ? normalizeCode(inviteCode) : "public";

  if (uploaderType === "guest") {
    return `${cleanVariant}/${cleanAlbum(album)}/${cleanInviteCode}/${photoId}.${extension}`;
  }

  return `${cleanVariant}/${cleanAlbum(album)}/${photoId}.${extension}`;
}

function buildR2PublicUrl(objectKey) {
  const { publicBaseUrl } = getR2Config();
  const base = publicBaseUrl.replace(/\/+$/, "");
  const encodedKey = String(objectKey)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  return `${base}/${encodedKey}`;
}

async function getPresignedPutUrl(objectKey, contentType) {
  const config = getR2Config();
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: objectKey,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable",
  });

  return getSignedUrl(getR2Client(), command, {
    expiresIn: config.presignedExpiresSeconds,
  });
}

async function getPresignedGetUrl(objectKey) {
  const config = getR2Config();
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: objectKey,
  });

  return getSignedUrl(getR2Client(), command, {
    expiresIn: config.presignedExpiresSeconds,
  });
}

async function ensureR2ObjectExists(objectKey) {
  const config = getR2Config();
  await getR2Client().send(
    new HeadObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
    })
  );
}

async function deleteR2ObjectIfPresent(objectKey) {
  if (!objectKey) return;

  const config = getR2Config();

  try {
    await getR2Client().send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
      })
    );
  } catch (error) {
    console.warn(`Unable to delete R2 object ${objectKey}:`, error);
  }
}

function serializeTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return value;
}

function getTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildPhotoResponse(photoId, photoData = {}, options = {}) {
  const includePrivate = options.includePrivate === true;

  const response = {
    id: photoId,
    url: photoData.url || null,
    thumbUrl: photoData.thumbUrl || photoData.url || null,
    altText: photoData.altText || "",
    approved: photoData.approved === true,
    album: photoData.album || null,
    uploaderType: photoData.uploaderType || null,
    guestName: photoData.guestName || null,
    uploadedAt: serializeTimestamp(photoData.uploadedAt),
    sizeBytes: photoData.sizeBytes ?? null,
    width: photoData.width ?? null,
    height: photoData.height ?? null,
    sortOrder: photoData.sortOrder ?? null,
  };

  if (includePrivate) {
    return {
      ...response,
      inviteCode: photoData.inviteCode || null,
      objectKey: photoData.objectKey || null,
      thumbObjectKey: photoData.thumbObjectKey || null,
      uploadStatus: photoData.uploadStatus || null,
      createdAt: serializeTimestamp(photoData.createdAt),
      updatedAt: serializeTimestamp(photoData.updatedAt),
    };
  }

  return response;
}

function sortPhotosForDisplay(a, b) {
  const aSort = a.sortOrder ?? 999999;
  const bSort = b.sortOrder ?? 999999;

  if (aSort !== bSort) return aSort - bSort;

  return getTimestampMillis(b.uploadedAt) - getTimestampMillis(a.uploadedAt);
}

async function createPhotoUploadSession({ payload, uploaderType, approved }) {
  const photoId = crypto.randomUUID();
  const album = cleanAlbum(payload.album);
  const extension = getExtensionForImage(payload.fileName, payload.contentType);
  const inviteCode = payload.inviteCode ? normalizeCode(payload.inviteCode) : null;

  const objectKey = buildR2ObjectKey({
    uploaderType,
    album,
    photoId,
    extension,
    inviteCode,
    variant: "original",
  });

  const thumbObjectKey = payload.createThumbnail
    ? buildR2ObjectKey({
        uploaderType,
        album,
        photoId,
        extension,
        inviteCode,
        variant: "thumb",
      })
    : null;

  const uploadToken = createUploadToken();
  const uploadTokenHash = hashUploadToken(uploadToken);
  const url = buildR2PublicUrl(objectKey);
  const thumbUrl = thumbObjectKey ? buildR2PublicUrl(thumbObjectKey) : url;

  const docData = {
    id: photoId,
    url,
    thumbUrl,
    altText: payload.altText || null,
    approved: approved === true,
    album,
    uploaderType,
    inviteCode: inviteCode || null,
    guestName: payload.guestName || null,
    uploadedAt: null,
    uploadStatus: "pending_upload",
    uploadTokenHash,
    objectKey,
    thumbObjectKey,
    sizeBytes: payload.sizeBytes ?? null,
    width: payload.width ?? null,
    height: payload.height ?? null,
    sortOrder: payload.sortOrder ?? null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await photosCollection.doc(photoId).set(docData);

  const uploadUrl = await getPresignedPutUrl(objectKey, payload.contentType);
  const thumbUploadUrl = thumbObjectKey
    ? await getPresignedPutUrl(thumbObjectKey, payload.contentType)
    : null;

  return {
    photoId,
    uploadToken,
    url,
    thumbUrl,
    objectKey,
    thumbObjectKey,
    upload: {
      method: "PUT",
      url: uploadUrl,
      requiredHeaders: {
        "Content-Type": payload.contentType,
      },
      expiresInSeconds: getR2Config().presignedExpiresSeconds,
    },
    thumbnailUpload: thumbUploadUrl
      ? {
          method: "PUT",
          url: thumbUploadUrl,
          requiredHeaders: {
            "Content-Type": payload.contentType,
          },
          expiresInSeconds: getR2Config().presignedExpiresSeconds,
        }
      : null,
  };
}

async function completePhotoUpload({ photoId, payload, requireUploadToken, approvedOverride }) {
  const photoRef = photosCollection.doc(photoId);
  const snapshot = await photoRef.get();

  if (!snapshot.exists) {
    return {
      status: 404,
      body: {
        isSuccess: false,
        message: "Photo not found",
      },
    };
  }

  const photoData = snapshot.data();

  if (requireUploadToken) {
    const suppliedHash = hashUploadToken(payload.uploadToken);

    if (!photoData.uploadTokenHash || suppliedHash !== photoData.uploadTokenHash) {
      return {
        status: 403,
        body: {
          isSuccess: false,
          message: "Invalid upload token",
        },
      };
    }
  }

  if (!photoData.objectKey) {
    return {
      status: 400,
      body: {
        isSuccess: false,
        message: "Photo does not have an R2 object key",
      },
    };
  }

  try {
    await ensureR2ObjectExists(photoData.objectKey);

    if (payload.thumbUploaded === true && photoData.thumbObjectKey) {
      await ensureR2ObjectExists(photoData.thumbObjectKey);
    }
  } catch (error) {
    console.error("Uploaded object could not be verified in R2:", error);

    return {
      status: 400,
      body: {
        isSuccess: false,
        message: "Uploaded file was not found in Cloudflare R2",
      },
    };
  }

  const updatedData = {
    uploadStatus: "uploaded",
    uploadedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    sizeBytes: payload.sizeBytes ?? photoData.sizeBytes ?? null,
    width: payload.width ?? photoData.width ?? null,
    height: payload.height ?? photoData.height ?? null,
  };

  if (typeof approvedOverride === "boolean") {
    updatedData.approved = approvedOverride;
  }

  if (payload.thumbUploaded !== true && photoData.thumbObjectKey) {
    // If no separate thumbnail was uploaded, use the original image URL as the fallback thumbnail.
    updatedData.thumbUrl = photoData.url;
    updatedData.thumbObjectKey = null;
  }

  await photoRef.update(updatedData);

  const updatedSnapshot = await photoRef.get();

  return {
    status: 200,
    body: {
      isSuccess: true,
      message: "Photo upload completed successfully",
      photo: buildPhotoResponse(updatedSnapshot.id, updatedSnapshot.data(), {
        includePrivate: true,
      }),
    },
  };
}

async function getImageRedirectUrl(photoData, variant) {
  if (variant === "thumb") {
    if (photoData.thumbUrl) return photoData.thumbUrl;
    if (photoData.url) return photoData.url;
    if (photoData.thumbObjectKey) return getPresignedGetUrl(photoData.thumbObjectKey);
  }

  if (photoData.url) return photoData.url;
  if (photoData.objectKey) return getPresignedGetUrl(photoData.objectKey);

  return null;
}

// ===================================
// Admin Auth Middleware
// ===================================
/**
 * Protects admin routes using a signed session token stored in a cookie.
 */
function adminAuthMiddleware(req, res, next) {
  try {
    const token = req.cookies?.[ADMIN_COOKIE_NAME];

    if (!token) {
      return res.status(401).json({
        isSuccess: false,
        message: "Unauthorized",
      });
    }

    jwt.verify(token, ADMIN_JWT_SECRET);
    return next();
  } catch (error) {
    return res.status(401).json({
      isSuccess: false,
      message: "Unauthorized",
    });
  }
}

// ===================================
// Token Status Checker
// ===================================
/**
 * Determines whether a token:
 * 1. Exists in the database
 * 2. Has already been fully used
 *
 * Updated functionality:
 * - A token is considered "used" only when ALL members in the household
 *   have submitted a response.
 *
 * Why:
 * - Keeps business logic separate from route handlers
 * - Makes logic reusable and easier to test
 *
 * @param {string} token
 * @param {Object} firebaseCollection - Firestore collection reference
 * @returns {Promise<Object>}
 */
export const checkTokenStatus = async (token, firebaseCollection) => {
  const invitedGuestSnapshot = await firebaseCollection.doc(token).get();

  // Token does not exist
  if (!invitedGuestSnapshot.exists) {
    return {
      exists: false,
      valid: false,
      used: false,
      message: TOKEN_MESSAGES.NOT_FOUND,
    };
  }

  const invitedGuestData = invitedGuestSnapshot.data();
  const members = invitedGuestData?.members || [];

  const allResponded =
    members.length > 0 &&
    members.every(
      (member) => member.rsvp === "yes" || member.rsvp === "no"
    );

  // Token already fully used (all household members responded)
  if (allResponded) {
    return {
      exists: true,
      valid: true,
      used: true,
      message: TOKEN_MESSAGES.USED,
      redirectUrl: defaultPageUrl,
    };
  }

  // Token is valid and not yet fully used
  return {
    exists: true,
    valid: true,
    used: false,
    message: TOKEN_MESSAGES.VALID,
  };
};
// ==========================================
// End Token Status Checker
// ==========================================

// =======================
// Public RSVP Routes
// =======================

// Health check endpoint
router.get("/ready", (req, res) => {
  return res.status(200).json({
    isSuccess: true,
    message: "API is ready to accept requests",
  });
});

// Retrieve token status
router.get("/token/:token/status", async (req, res) => {
  try {
    const { token } = req.params;

    const tokenStatus = await checkTokenStatus(token, invitedGuestsCollection);

    // Token not found
    if (!tokenStatus.exists) {
      return res.status(404).json({
        isSuccess: false,
        token,
        valid: false,
        used: false,
        message: tokenStatus.message,
      });
    }

    // Token fully used
    if (tokenStatus.used) {
      return res.status(200).json({
        isSuccess: true,
        token,
        valid: true,
        used: true,
        message: tokenStatus.message,
        url: tokenStatus.redirectUrl,
      });
    }

    // Token is valid and still open for responses
    return res.status(200).json({
      isSuccess: true,
      token,
      valid: true,
      used: false,
      message: tokenStatus.message,
    });
  } catch (error) {
    console.error("Error checking token status:", error);

    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
    });
  }
});

/* Was here for initial set up and learning
// retrieve information for a token
router.get("/token", (req, res) =>{
    return res.status(200).json({
        personalizedAddy : "Mr. John",
        personalizedHouseholdAddy : "Mr. John",
        householdSize: "2",
        householdMembers: [
            {
                name: "Jane",
                personalizedAddy: "Miss Jane"
            },
            {
                name: "Jonny",
                personalizedAddy: "Little Jonny"
            }
        ]
    })
});
*/


//setting up endpoint to retrieve info from the firestore
// Updated functionality:
// We now store one document per household code, so we can return the household
// document directly instead of querying multiple guest docs by household name.
router.get("/token/:token", async (req, res) => {
  try {
    const token = req.params.token;

    // lets use the built in get method
    const invitedGuestSnapshot = await invitedGuestsCollection.doc(token).get();

    if (!invitedGuestSnapshot.exists) {
      return res.status(404).json({
        isSuccess: false,
        token: `${token}`,
        message: "guest does not exist",
      });
    } else {
      const householdData = invitedGuestSnapshot.data();

      return res.status(200).json({
        isSuccess: true,
        token: householdData.code,
        household: householdData.household,
        householdSize: householdData.householdSize,
        allResponded: householdData.allResponded ?? false,
        members: householdData.members || [],
      });
    }
  } catch (error) {
    console.error("Error retrieving token data:", error);

    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
    });
  }
});


// remember if you are retuning (req, res) that is middleware and it must be passed into the route definition
// Submit RSVP response for a token
// Updated functionality:
// Frontend submits a single payload containing responses for all members in the household.
// Each member is updated by memberId instead of storing one top-level rsvp field.
router.post("/token/:token/reply", validateRequest(rsvpRequest), async (req, res) => {
  try {
    const { token } = req.params;
    const { responses } = req.body;

    // Check whether the token exists
    const tokenStatus = await checkTokenStatus(token, invitedGuestsCollection);

    // Token does not exist
    if (!tokenStatus.exists) {
      return res.status(404).json({
        isSuccess: false,
        token,
        valid: false,
        used: false,
        message: tokenStatus.message,
      });
    }

    // Token already fully used
    if (tokenStatus.used) {
      return res.status(409).json({
        isSuccess: true,
        token,
        valid: true,
        used: true,
        message: tokenStatus.message,
        url: tokenStatus.redirectUrl,
      });
    }

    const invitedGuestDocRef = invitedGuestsCollection.doc(token);
    const invitedGuestSnapshot = await invitedGuestDocRef.get();
    const invitedGuestData = invitedGuestSnapshot.data();
    const existingMembers = invitedGuestData?.members || [];

    // Build a quick lookup map for submitted responses
    const responseMap = new Map(
      responses.map((response) => [response.memberId, response.rsvp])
    );

    // Update matching members only
    const updatedMembers = existingMembers.map((member) => {
      if (!responseMap.has(member.memberId)) {
        return member;
      }

      return {
        ...member,
        rsvp: responseMap.get(member.memberId),
        respondedAt: new Date().toISOString(),
      };
    });

    const allResponded = calculateAllResponded(updatedMembers);

    // Update the household document with member responses
    await invitedGuestDocRef.update({
      members: updatedMembers,
      allResponded,
      respondedAt: allResponded ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return res.status(200).json({
      isSuccess: true,
      token,
      allResponded,
      message: "RSVP responses recorded successfully",
    });
  } catch (error) {
    console.error("Error recording RSVP response:", error);

    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
    });
  }
});


// =======================
// Public Photo Gallery Routes
// =======================

// List approved photos for the Jekyll frontend gallery.
router.get("/photos", async (req, res) => {
  try {
    let photosQuery = photosCollection.where("approved", "==", true);
    const album = cleanAlbum(req.query.album || "");

    if (req.query.album) {
      photosQuery = photosQuery.where("album", "==", album);
    }

    const snapshot = await photosQuery.get();

    const photos = snapshot.docs
      .map((doc) => buildPhotoResponse(doc.id, doc.data()))
      .sort(sortPhotosForDisplay);

    return res.status(200).json({
      isSuccess: true,
      photos,
    });
  } catch (error) {
    console.error("Error loading public photos:", error);

    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
    });
  }
});

// Guest starts a direct browser upload to Cloudflare R2.
router.post(
  "/photos/upload-url",
  validateRequest(guestPhotoUploadRequest),
  async (req, res) => {
    try {
      const normalizedInviteCode = req.body.inviteCode
        ? normalizeCode(req.body.inviteCode)
        : null;

      const payload = {
        ...req.body,
        inviteCode: normalizedInviteCode,
      };

      // For QR-code uploads, inviteCode can be omitted.
      // If it is supplied, validate that it maps to a real invited household.
      if (normalizedInviteCode) {
        const invitedGuestSnapshot = await invitedGuestsCollection
          .doc(normalizedInviteCode)
          .get();

        if (!invitedGuestSnapshot.exists) {
          return res.status(404).json({
            isSuccess: false,
            message: "Invite code not found",
          });
        }
      }

      const uploadSession = await createPhotoUploadSession({
        payload,
        uploaderType: "guest",
        approved: false,
      });

      return res.status(201).json({
        isSuccess: true,
        message: "Upload URL created successfully",
        ...uploadSession,
      });
    } catch (error) {
      console.error("Error creating guest photo upload URL:", error);

      return res.status(500).json({
        isSuccess: false,
        message: "Internal server error",
      });
    }
  }
);

// Guest marks a direct browser upload as completed after PUTing to Cloudflare R2.
router.post(
  "/photos/:photoId/complete",
  validateRequest(photoIdRequest, "params"),
  validateRequest(guestPhotoCompleteRequest),
  async (req, res) => {
    try {
      const result = await completePhotoUpload({
        photoId: req.params.photoId,
        payload: req.body,
        requireUploadToken: true,
      });

      return res.status(result.status).json(result.body);
    } catch (error) {
      console.error("Error completing guest photo upload:", error);

      return res.status(500).json({
        isSuccess: false,
        message: "Internal server error",
      });
    }
  }
);

router.get("/photos/:photoId", validateRequest(photoIdRequest, "params"), async (req, res) => {
  try {
    const { photoId } = req.params;
    const photoSnapshot = await photosCollection.doc(photoId).get();

    if (!photoSnapshot.exists) {
      return res.status(404).json({
        isSuccess: false,
        message: "Photo not found",
      });
    }

    const photoData = photoSnapshot.data();

    if (photoData.approved !== true || photoData.uploadStatus === "pending_upload") {
      return res.status(404).json({
        isSuccess: false,
        message: "Photo not found",
      });
    }

    return res.status(200).json({
      isSuccess: true,
      photo: buildPhotoResponse(photoSnapshot.id, photoData),
    });
  } catch (error) {
    console.error("Error loading photo:", error);

    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
    });
  }
});

router.get(
  "/photos/:photoId/image",
  validateRequest(photoIdRequest, "params"),
  async (req, res) => {
    try {
      const { photoId } = req.params;
      const photoSnapshot = await photosCollection.doc(photoId).get();

      if (!photoSnapshot.exists) {
        return res.status(404).json({
          isSuccess: false,
          message: "Photo not found",
        });
      }

      const photoData = photoSnapshot.data();

      if (photoData.approved !== true || photoData.uploadStatus === "pending_upload") {
        return res.status(404).json({
          isSuccess: false,
          message: "Photo not found",
        });
      }

      const redirectUrl = await getImageRedirectUrl(photoData, "image");

      if (!redirectUrl) {
        return res.status(404).json({
          isSuccess: false,
          message: "Photo image not found",
        });
      }

      return res.redirect(302, redirectUrl);
    } catch (error) {
      console.error("Error redirecting to photo image:", error);

      return res.status(500).json({
        isSuccess: false,
        message: "Internal server error",
      });
    }
  }
);

router.get(
  "/photos/:photoId/thumb",
  validateRequest(photoIdRequest, "params"),
  async (req, res) => {
    try {
      const { photoId } = req.params;
      const photoSnapshot = await photosCollection.doc(photoId).get();

      if (!photoSnapshot.exists) {
        return res.status(404).json({
          isSuccess: false,
          message: "Photo not found",
        });
      }

      const photoData = photoSnapshot.data();

      if (photoData.approved !== true || photoData.uploadStatus === "pending_upload") {
        return res.status(404).json({
          isSuccess: false,
          message: "Photo not found",
        });
      }

      const redirectUrl = await getImageRedirectUrl(photoData, "thumb");

      if (!redirectUrl) {
        return res.status(404).json({
          isSuccess: false,
          message: "Photo thumbnail not found",
        });
      }

      return res.redirect(302, redirectUrl);
    } catch (error) {
      console.error("Error redirecting to photo thumbnail:", error);

      return res.status(500).json({
        isSuccess: false,
        message: "Internal server error",
      });
    }
  }
);

// =======================
// Admin Auth Routes
// =======================

/// Admin login endpoint
// Used by the /admin dashboard page to create an authenticated session.
adminRouter.post("/login", validateRequest(adminLoginRequest), async (req, res) => {
  try {
    const { username, password } = req.body;

    if (username !== ADMIN_USERNAME) {
      return res.status(401).json({
        isSuccess: false,
        message: "Invalid credentials",
      });
    }

    const passwordMatches = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);

    if (!passwordMatches) {
      return res.status(401).json({
        isSuccess: false,
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      { username: ADMIN_USERNAME, role: "admin" },
      ADMIN_JWT_SECRET,
      { expiresIn: "8h" }
    );

    // Updated cookie settings:
    // - secure stays true for production HTTPS
    // - sameSite is relaxed from "strict" to "lax"
    // - path is explicitly set so the cookie is sent to all admin routes
    res.cookie(ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      isSuccess: true,
      message: "Login successful",
    });
  } catch (error) {
    console.error("Admin login error:", error);

    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
    });
  }
});

// Admin logout endpoint
adminRouter.post("/logout", (req, res) => {
  // Updated cookie settings:
  // These must match the cookie settings used when the cookie was created.
  res.clearCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });

  return res.status(200).json({
    isSuccess: true,
    message: "Logout successful",
  });
});

// All admin routes below this point require login
adminRouter.use(adminAuthMiddleware);

// =======================
// Admin Dashboard Routes
// =======================

// Read all households for admin dashboard table/grid view
adminRouter.get("/households", async (req, res) => {
  try {
    const snapshot = await invitedGuestsCollection.orderBy("household").get();

    const households = snapshot.docs.map((doc) => ({
      ...doc.data(),
    }));

    return res.status(200).json({
      isSuccess: true,
      households,
    });
  } catch (error) {
    console.error("Error loading households:", error);

    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
    });
  }
});

// Create household
// Allows admin to add new guest households directly from the dashboard.
//
// IMPORTANT CHANGE:
// - code is generated on the server
// - uniqueUrl is generated from that code
// - memberId values are generated on the server
adminRouter.post(
  "/households",
  validateRequest(adminHouseholdRequest),
  async (req, res) => {
    try {
      const payload = req.body;

      // Generate a brand new unique household code on the server
      const code = await generateUniqueHouseholdCode(invitedGuestsCollection);

      // Generate member IDs automatically from the code
      const members = payload.members.map((member, index) => ({
        name: member.name,
        personalizedAddy: member.personalizedAddy || null,
        rsvp: member.rsvp ?? null,
        memberId: `${code}_${index + 1}`,
      }));

      const allResponded = calculateAllResponded(members);

      await invitedGuestsCollection.doc(code).set({
        code,
        uniqueUrl: buildUniqueUrl(code),
        household: payload.household,
        householdSize: payload.householdSize || members.length,
        allResponded,
        respondedAt: allResponded ? FieldValue.serverTimestamp() : null,
        members,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return res.status(201).json({
        isSuccess: true,
        message: "Household created successfully",
      });
    } catch (error) {
      console.error("Error creating household:", error);

      return res.status(500).json({
        isSuccess: false,
        message: "Internal server error",
      });
    }
  }
);

// Update household
//
// IMPORTANT CHANGE:
// - Household code can NO LONGER be changed
// - Unique URL can NO LONGER be changed
// - Existing member IDs are preserved automatically
// - New member IDs are generated automatically only for new members
adminRouter.put(
  "/households/:code",
  validateRequest(adminHouseholdRequest),
  async (req, res) => {
    try {
      const code = normalizeCode(req.params.code);
      const payload = req.body;

      const docRef = invitedGuestsCollection.doc(code);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return res.status(404).json({
          isSuccess: false,
          message: "Household not found",
        });
      }

      const existingData = snapshot.data();
      const existingMembers = existingData?.members || [];

      // Preserve existing member IDs by index position.
      // New rows get a fresh system-generated member ID.
      const members = payload.members.map((member, index) => ({
        name: member.name,
        personalizedAddy: member.personalizedAddy || null,
        rsvp: member.rsvp ?? null,
        memberId: existingMembers[index]?.memberId || `${code}_${index + 1}`,
        respondedAt: existingMembers[index]?.respondedAt || null,
      }));

      const allResponded = calculateAllResponded(members);

      const updatedData = {
        code, // immutable
        uniqueUrl: buildUniqueUrl(code), // immutable and always derived from code
        household: payload.household,
        householdSize: payload.householdSize || members.length,
        allResponded,
        respondedAt: allResponded ? FieldValue.serverTimestamp() : null,
        members,
        createdAt: existingData.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      await docRef.set(updatedData, { merge: true });

      return res.status(200).json({
        isSuccess: true,
        message: "Household updated successfully",
      });
    } catch (error) {
      console.error("Error updating household:", error);

      return res.status(500).json({
        isSuccess: false,
        message: "Internal server error",
      });
    }
  }
);


// =======================
// Admin Photo Gallery Routes
// =======================

// Read all photo records for admin dashboard management.
adminRouter.get("/photos", async (req, res) => {
  try {
    const snapshot = await photosCollection.get();

    const photos = snapshot.docs
      .map((doc) =>
        buildPhotoResponse(doc.id, doc.data(), {
          includePrivate: true,
        })
      )
      .sort(sortPhotosForDisplay);

    return res.status(200).json({
      isSuccess: true,
      photos,
    });
  } catch (error) {
    console.error("Error loading admin photos:", error);

    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
    });
  }
});

// Admin starts a direct browser upload to Cloudflare R2.
adminRouter.post(
  "/photos/upload-url",
  validateRequest(adminPhotoUploadRequest),
  async (req, res) => {
    try {
      const payload = {
        ...req.body,
        inviteCode: req.body.inviteCode ? normalizeCode(req.body.inviteCode) : null,
      };

      const uploadSession = await createPhotoUploadSession({
        payload,
        uploaderType: "admin",
        approved: payload.approved === true,
      });

      return res.status(201).json({
        isSuccess: true,
        message: "Upload URL created successfully",
        ...uploadSession,
      });
    } catch (error) {
      console.error("Error creating admin photo upload URL:", error);

      return res.status(500).json({
        isSuccess: false,
        message: "Internal server error",
      });
    }
  }
);

// Admin marks a direct browser upload as completed after PUTing to Cloudflare R2.
adminRouter.post(
  "/photos/:photoId/complete",
  validateRequest(photoIdRequest, "params"),
  validateRequest(adminPhotoCompleteRequest),
  async (req, res) => {
    try {
      const result = await completePhotoUpload({
        photoId: req.params.photoId,
        payload: req.body,
        requireUploadToken: false,
        approvedOverride: req.body.approved,
      });

      return res.status(result.status).json(result.body);
    } catch (error) {
      console.error("Error completing admin photo upload:", error);

      return res.status(500).json({
        isSuccess: false,
        message: "Internal server error",
      });
    }
  }
);

// Manual metadata create for an already-hosted image URL.
adminRouter.post("/photos", validateRequest(adminPhotoRequest), async (req, res) => {
  try {
    const payload = req.body;
    const photoId = payload.id || crypto.randomUUID();

    const photoData = {
      id: photoId,
      url: payload.url,
      thumbUrl: payload.thumbUrl || payload.url,
      altText: payload.altText || null,
      approved: payload.approved === true,
      album: payload.album || null,
      uploaderType: payload.uploaderType || "admin",
      inviteCode: payload.inviteCode ? normalizeCode(payload.inviteCode) : null,
      guestName: payload.guestName || null,
      uploadedAt: payload.uploadedAt ? new Date(payload.uploadedAt) : FieldValue.serverTimestamp(),
      uploadStatus: "uploaded",
      sizeBytes: payload.sizeBytes ?? null,
      width: payload.width ?? null,
      height: payload.height ?? null,
      sortOrder: payload.sortOrder ?? null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await photosCollection.doc(photoId).set(photoData);

    const snapshot = await photosCollection.doc(photoId).get();

    return res.status(201).json({
      isSuccess: true,
      message: "Photo created successfully",
      photo: buildPhotoResponse(snapshot.id, snapshot.data(), {
        includePrivate: true,
      }),
    });
  } catch (error) {
    console.error("Error creating photo metadata:", error);

    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
    });
  }
});

adminRouter.put(
  "/photos/:photoId",
  validateRequest(photoIdRequest, "params"),
  validateRequest(adminPhotoUpdateRequest),
  async (req, res) => {
    try {
      const { photoId } = req.params;
      const payload = req.body;

      const photoRef = photosCollection.doc(photoId);
      const snapshot = await photoRef.get();

      if (!snapshot.exists) {
        return res.status(404).json({
          isSuccess: false,
          message: "Photo not found",
        });
      }

      const updatedData = {
        updatedAt: FieldValue.serverTimestamp(),
      };

      for (const key of [
        "url",
        "thumbUrl",
        "altText",
        "approved",
        "album",
        "uploaderType",
        "guestName",
        "sizeBytes",
        "width",
        "height",
        "sortOrder",
      ]) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
          updatedData[key] = payload[key] === "" ? null : payload[key];
        }
      }

      if (Object.prototype.hasOwnProperty.call(payload, "inviteCode")) {
        updatedData.inviteCode = payload.inviteCode ? normalizeCode(payload.inviteCode) : null;
      }

      if (Object.prototype.hasOwnProperty.call(payload, "uploadedAt")) {
        updatedData.uploadedAt = payload.uploadedAt ? new Date(payload.uploadedAt) : null;
      }

      await photoRef.set(updatedData, { merge: true });

      const updatedSnapshot = await photoRef.get();

      return res.status(200).json({
        isSuccess: true,
        message: "Photo updated successfully",
        photo: buildPhotoResponse(updatedSnapshot.id, updatedSnapshot.data(), {
          includePrivate: true,
        }),
      });
    } catch (error) {
      console.error("Error updating photo:", error);

      return res.status(500).json({
        isSuccess: false,
        message: "Internal server error",
      });
    }
  }
);

// Delete a photo metadata record.
// This intentionally does not delete the Storage file, so you do not accidentally
// remove original wedding photos from the bucket.
adminRouter.delete(
  "/photos/:photoId",
  validateRequest(photoIdRequest, "params"),
  async (req, res) => {
    try {
      const { photoId } = req.params;
      const deleteFiles = String(req.query.deleteFiles || "false") === "true";

      const photoRef = photosCollection.doc(photoId);
      const snapshot = await photoRef.get();

      if (!snapshot.exists) {
        return res.status(404).json({
          isSuccess: false,
          message: "Photo not found",
        });
      }

      const photoData = snapshot.data();

      if (deleteFiles) {
        await deleteR2ObjectIfPresent(photoData.objectKey);
        await deleteR2ObjectIfPresent(photoData.thumbObjectKey);
      }

      await photoRef.delete();

      return res.status(200).json({
        isSuccess: true,
        message: deleteFiles
          ? "Photo metadata and R2 files deleted successfully"
          : "Photo metadata deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting photo:", error);

      return res.status(500).json({
        isSuccess: false,
        message: "Internal server error",
      });
    }
  }
);

// ===================
// End of router paths
// ===================

// connecting application to routers and version "/v1"
// meaning every router path is prefixed with v1
app.use(apiVersion, router);
app.use(`${apiVersion}${ADMIN_BASE_PATH}`, adminRouter);

// export firebase function
export const api = onRequest(
  {
    //max instance for firebase
    maxInstances: 3,
    concurrency: 20,
    timeoutSeconds: 60,
  },

  //passing the express aplication straight to the firebase fucntion
  app,
);