// firebase.js  (keep in parent folder as you had)
import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBwMv_hfByidn1IVp9o4FN4WmvCpcST0hU",
  authDomain: "studybuddytcet.firebaseapp.com",
  projectId: "studybuddytcet",
  storageBucket: "studybuddytcet.firebasestorage.app",
  messagingSenderId: "603759519713",
  appId: "1:603759519713:web:544660c31f2af12c8c54a0",
  databaseURL: "https://studybuddytcet-default-rtdb.firebaseio.com/",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export default app;