// Express application set up
import express from "express";
const app = express();
const router = express.Router();


// APi validation library
import Joi from "joi";


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

// setting up api version
const apiVersion = "/v1";

//declaring global to store base page redirect url
const defaultPageUrl = "https://tevinandnatalie.com/";

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
// Routes
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

    if (tokenStatus.used){
        return res.status(409).json({
            isSuccess: true,
        token,
        valid: true,
        used: true,
        message: tokenStatus.message,
        url: tokenStatus.redirectUrl,
        })
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

    const allResponded =
      updatedMembers.length > 0 &&
      updatedMembers.every(
        (member) => member.rsvp === "yes" || member.rsvp === "no"
      );

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
// ===================
// End of router paths
// ===================


// connecting application to router and version "/v1", meaning every router path is prefixed with v1
app.use(apiVersion, router);

// export firebase function
export const api = onRequest(
  {
    // allowing browsers to only hit from the url
    cors: [
      "https://tevinandnatalie.com",
    ],

    //max instance for firebase
    maxInstances: 3,
    concurrency: 20,
  },

  //passing the express aplication straight to the firebase fucntion
  app
);