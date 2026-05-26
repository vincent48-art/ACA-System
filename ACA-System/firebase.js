// Firebase configuration and initialization for compat mode
const firebaseConfig = {
  apiKey: "AIzaSyBW8KByAMuFVG3mM2yCW_QgIEEt6pEG7xI",
  authDomain: "aca-system-e106e.firebaseapp.com",
  projectId: "aca-system-e106e",
  storageBucket: "aca-system-e106e.firebasestorage.app",
  messagingSenderId: "499850650085",
  appId: "1:499850650085:web:ec972224d9eda212e5cf0c"
};

firebase.initializeApp(firebaseConfig);
window.auth = firebase.auth();
window.db = firebase.firestore();
