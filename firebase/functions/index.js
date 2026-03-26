// Express application set up
const express = require("express");
const app = express;
const router = express.Router();


// APi validation library
const JOI = require ("joi");


//Firebase and firestore set-up
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https")
const {getFirestore, FIeldValue} = require("firebase-admin/firestore")

admin.initializeApp();
const db = getFirestore();



//Setting up API spec validation
const rsvpResponse = JOI.object({
    rsvp: JOI.string()
    .valid("yes","no")
    .required()
    .messages(
        "any.only": "rsvp value can only be yes or no",
        "string.empty": "rsvp is required"
     )
})


// setting up api version
const apiVersion = "/v1";





