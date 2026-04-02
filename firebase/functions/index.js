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

admin.initializeApp();
const db = getFirestore();

//declaring global collect of guest stuff
const invitedGuestsCollection = db.collection("InvitedGuests");


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
const adminHouseholdRequest = Joi.object({
  code: Joi.string().trim().length(6).required(),
  uniqueUrl: Joi.string().uri().required(),
  household: Joi.string().trim().required(),
  householdSize: Joi.number().integer().min(1).required(),
  members: Joi.array()
    .items(
      Joi.object({
        memberId: Joi.string().trim().required(),
        name: Joi.string().trim().required(),
        personalizedAddy: Joi.string().allow("", null),
        rsvp: Joi.string().valid("yes", "no").allow(null),
      })
    )
    .min(1)
    .required(),
});

// setting up api version
const apiVersion = "/v1";

//declaring global to store base page redirect url
const defaultPageUrl = "https://tevinandnatalie.com/";

// ===================================
// Admin config
// ===================================
// Protect admin dashboard with username/password.
// Successful login returns an httpOnly cookie session.
//
// IMPORTANT:
// In production these should come from environment variables
// or Firebase runtime config, not be hardcoded in the file.
const ADMIN_COOKIE_NAME = "__session";
const ADMIN_BASE_PATH = "/admin";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "clientadmin";
const ADMIN_PASSWORD_HASH =
  process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync("change-this-password", 10);
const ADMIN_JWT_SECRET =
  process.env.ADMIN_JWT_SECRET || "change-this-secret";

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
app.use(express.json({ limit: "10kb" }));

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
  "https://tevinandnatalie.com",
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
  return `https://tevinandnatalie.com/${code}`;
}

// Normalize code to 6 uppercase alphanumeric characters
function normalizeCode(code) {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

// Determine whether every member in a household has responded
function calculateAllResponded(members = []) {
  return (
    members.length > 0 &&
    members.every((member) => member.rsvp === "yes" || member.rsvp === "no")
  );
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
adminRouter.post(
  "/households",
  validateRequest(adminHouseholdRequest),
  async (req, res) => {
    try {
      const payload = req.body;
      const code = normalizeCode(payload.code);

      const existingSnapshot = await invitedGuestsCollection.doc(code).get();

      if (existingSnapshot.exists) {
        return res.status(409).json({
          isSuccess: false,
          message: "A household with that code already exists",
        });
      }

      const members = payload.members.map((member, index) => ({
        ...member,
        memberId: member.memberId || `${code}_${index + 1}`,
      }));

      const allResponded = calculateAllResponded(members);

      await invitedGuestsCollection.doc(code).set({
        code,
        uniqueUrl: payload.uniqueUrl || buildUniqueUrl(code),
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

// Update household, including changing the 6 character code and URL
// If the code changes, we create the new document and delete the old one.
adminRouter.put(
  "/households/:code",
  validateRequest(adminHouseholdRequest),
  async (req, res) => {
    try {
      const oldCode = normalizeCode(req.params.code);
      const payload = req.body;
      const newCode = normalizeCode(payload.code);

      const oldDocRef = invitedGuestsCollection.doc(oldCode);
      const oldSnapshot = await oldDocRef.get();

      if (!oldSnapshot.exists) {
        return res.status(404).json({
          isSuccess: false,
          message: "Household not found",
        });
      }

      if (oldCode !== newCode) {
        const newSnapshot = await invitedGuestsCollection.doc(newCode).get();

        if (newSnapshot.exists) {
          return res.status(409).json({
            isSuccess: false,
            message: "Another household already uses that code",
          });
        }
      }

      const members = payload.members.map((member, index) => ({
        ...member,
        memberId: member.memberId || `${newCode}_${index + 1}`,
      }));

      const allResponded = calculateAllResponded(members);

      const updatedData = {
        code: newCode,
        uniqueUrl: payload.uniqueUrl || buildUniqueUrl(newCode),
        household: payload.household,
        householdSize: payload.householdSize || members.length,
        allResponded,
        respondedAt: allResponded ? FieldValue.serverTimestamp() : null,
        members,
        createdAt: oldSnapshot.data().createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (oldCode === newCode) {
        await oldDocRef.set(updatedData, { merge: true });
      } else {
        const batch = db.batch();
        batch.set(invitedGuestsCollection.doc(newCode), updatedData);
        batch.delete(oldDocRef);
        await batch.commit();
      }

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
  },

  //passing the express aplication straight to the firebase fucntion
  app,
);