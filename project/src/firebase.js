/* ============================================================
   BRAINWORK ROYALE — FIREBASE SDK SETUP
   Initializes Firebase (App / Auth / Firestore / Storage) and
   exposes everything on `window.firebase` for the Babel-compiled
   JSX files to consume.

   HOW TO USE
   ----------
   1. Go to https://console.firebase.google.com/ and create (or
      open) your project.
   2. Project Settings -> "Your apps" -> Web app -> SDK setup and
      configuration -> Config. Copy the firebaseConfig object.
   3. Paste your values into FIREBASE_CONFIG below.
   4. Enable the services you need in the console:
        - Authentication (Email/Password, Google, etc.)
        - Firestore Database
        - Storage
   5. Set Firestore Security Rules. THIS is where the real
      security lives. The apiKey below is public by design.

   Loaded as <script type="module"> from app.html and index.html
   BEFORE any Babel/JSX script, so window.firebase.* is ready by
   the time React mounts.
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInAnonymously,
  GoogleAuthProvider,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";

// ============================================================
// FILL THIS IN with your project's web config
// (Firebase Console -> Project Settings -> Your apps -> SDK setup)
// ============================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCy3hUOoZMM0ScjwOb2rh_znmvcJ8dHLmo",
  authDomain: "brainwork-royale.firebaseapp.com",
  projectId: "brainwork-royale",
  storageBucket: "brainwork-royale.firebasestorage.app",
  messagingSenderId: "1019544776261",
  appId: "1:1019544776261:web:3425ae93b21b1138eebd2c"
  // measurementId: "G-XXXXXXXXXX", // optional, only if you enable Analytics
};

// ============================================================
// Init
// ============================================================
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ============================================================
// Expose to non-module code (Babel-compiled <script type="text/babel">
// cannot use ESM `import`, so we hang everything on window.firebase)
// ============================================================
window.firebase = {
  app,
  auth,
  db,
  storage,

  // Auth helpers
  onAuthStateChanged: (cb) => onAuthStateChanged(auth, cb),
  signInEmail: (email, password) => signInWithEmailAndPassword(auth, email, password),
  signUpEmail: (email, password) => createUserWithEmailAndPassword(auth, email, password),
  signInGoogle: () => signInWithPopup(auth, new GoogleAuthProvider()),
  signInAnon: () => signInAnonymously(auth),
  signOut: () => signOut(auth),

  // Firestore primitives — pass through so the JSX code can compose queries
  collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp,

  // Storage primitives
  storageRef, uploadBytes, getDownloadURL,
};

window.dispatchEvent(new Event("firebase-ready"));
