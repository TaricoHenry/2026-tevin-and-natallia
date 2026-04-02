// Express application set up
import express from "express";
const app = express();
const router = express.Router();


// APi validation library
import Joi from "Joi";


//Firebase and firestore set-up
import admin from "firebase-admin"; //import firbase sdk
import { onRequest } from "firebase-functions/v2/https"; //using firbase function handler for http requests
import {getFirestore, FieldValue} from "firebase-admin/firestore"; //importing firebase databse tools

admin.initializeApp(); 
const db = getFirestore();

//declaring global collect of guest stuff
const invitedGuestsCollection = db.collection('InvitedGuests');


//Setting up API spec validation
const rsvpRequest = Joi.object({
    rsvp: Joi.string()
    .valid("yes","no")
    .required()
    .messages({
        "any.only": "rsvp value can only be yes or no",
        "string.empty": "rsvp is required"
    })
});

// setting up api version
const apiVersion = "/v1";

//declaring global to store base page redirect url
const defaultPageUrl = "https://tevinandnatallia.com/";

// ===================================
// Centralized response message constants
// ===================================
// Using constants prevents bugs caused by typos
// and avoids relying on fragile string comparisons
export const TOKEN_MESSAGES = {
  NOT_FOUND: "Guest does not exist",
  USED: "Token has already been used",
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
      path: detail.path.join("."), // fixed bug: join (not Join)
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
 * 2. Has already been used
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
      message: TOKEN_MESSAGES.NOT_FOUND,
    };
  }

  const invitedGuestData = invitedGuestSnapshot.data();

  // Token already used (RSVP exists)
  if (invitedGuestData?.rsvp != null) {
    return {
      exists: true,
      valid: false,
      message: TOKEN_MESSAGES.USED,
      redirectUrl: defaultPageUrl,
    };
  }

  // Token is valid and unused
  return {
    exists: true,
    valid: true,
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
        message: tokenStatus.message,
      });
    }

    // Token already used
    if (!tokenStatus.valid) {
      return res.status(200).json({
        isSuccess: true,
        token,
        valid: false,
        message: tokenStatus.message,
        url: tokenStatus.redirectUrl,
      });
    }

    // Token is valid
    return res.status(200).json({
      isSuccess: true,
      token,
      valid: true,
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
});*/


//setting up endpoint to retrieve info from the firestore
router.get("/token/:token", async (req, res, next) => {

    const token = req.params.token
    //get info from firestore
    //setting a reference to the entire collection
    //const invitedGuestsCollection = db.collection('InvitedGuests');

    //using a querry (not the most the efficient method)
    //const invitedGuestSnapshot = invitedGuestsCollection.where('token', '==', `${req.params.token}`);
    
    //lets use the built in get method
    const invitedGuestSnapshot = await invitedGuestsCollection.doc(`${token}`).get();

    if (!invitedGuestSnapshot.exists){
        return res.status(404).json({
            isSuccess: false,
            token: `${token}`,
            message: "guest does not exist"
        });
    }else {
        console.log(JSON.stringify(invitedGuestSnapshot.data()))
        const householdMembers = await invitedGuestsCollection.where('household', '==', `${invitedGuestSnapshot.data().household}`).get();
        
        householdMembers.forEach(doc => {
            console.log(doc.data());
        })
            
        return res.status(200).json({
            household: invitedGuestSnapshot.data().household, 
            members: householdMembers.docs.map(doc => doc.data().personalizedAddy)
        })
    }



})


// remember if you are retuning (req, res) that is middleware and it must be passed into the route definition
// Submit RSVP response for a token
router.post("/token/:token/reply", validateRequest(rsvpRequest), async (req, res) => {
  try {
    const { token } = req.params;
    const { rsvp } = req.body;

    // Check whether the token exists and has not already been used
    const tokenStatus = await checkTokenStatus(token, invitedGuestsCollection);

    // Token does not exist
    if (!tokenStatus.exists) {
      return res.status(404).json({
        isSuccess: false,
        token,
        valid: false,
        message: tokenStatus.message,
      });
    }

    // Token has already been used
    if (!tokenStatus.valid) {
      return res.status(200).json({
        isSuccess: false,
        token,
        valid: false,
        message: tokenStatus.message,
        url: tokenStatus.redirectUrl,
      });
    }

    // Update the guest document with the RSVP response
    await invitedGuestsCollection.doc(token).update({
      rsvp,
      respondedAt: FieldValue.serverTimestamp(),
    });

    return res.status(200).json({
      isSuccess: true,
      token,
      message: "RSVP response recorded successfully",
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
            "https://tevinandnatallia.com"
        ],

        //max instance for firebase
        maxInstances: 3,
        concurrency: 20
    },

    //passing the express aplication straight to the firebase fucntion
    app
);


