import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { 
  getAuth, 
  signOut,
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword 
} from "firebase/auth";
import { 
  getFirestore, 
  collection, 
  getDocs, 
  getDoc,
  setDoc, 
  doc 
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDiKD_KHzz2nYZ5cQw5MOUahDzGz2Cywu8",
  authDomain: "trustcharge-1c1f3.firebaseapp.com",
  projectId: "trustcharge-1c1f3",
  storageBucket: "trustcharge-1c1f3.firebasestorage.app",
  messagingSenderId: "856288146861",
  appId: "1:856288146861:web:f1b9c053c2030ccb98dd24",
  measurementId: "G-12EC2QM969"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export { 
  auth, 
  db,
  signOut,
  googleProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  collection,
  getDocs,
  getDoc,
  setDoc,
  doc
};