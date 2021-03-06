const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { object } = require("firebase-functions/lib/providers/storage");
const { auth } = require("firebase-admin");
const mimeTypes = require("mime-types");

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

admin.initializeApp();

exports.createAuthor = functions.https.onCall(async (data, context) => {
  verifyAuthenticated(context, true);
  validateData(data, {
    name: "string",
  });

  const author = await admin
    .firestore()
    .collection("authors")
    .where("name", "==", data.name)
    .limit(1)
    .get();

  if (!author.empty) {
    throw new functions.https.HttpsError(
      "already-exists",
      "This author already exists!"
    );
  }

  return admin.firestore().collection("authors").add({
    name: data.name,
  });
});

exports.createProfile = functions.https.onCall(async (data, context) => {
  verifyAuthenticated(context);
  validateData(data, {
    username: "string",
  });

  // check if profile already exists for the user
  const idMatch = await admin
    .firestore()
    .collection("profiles")
    .where("userId", "==", context.auth.uid)
    .limit(1)
    .get();
  if (idMatch.exists) {
    throw new functions.https.HttpsError(
      "already-exists",
      "This user already has a profile!"
    );
  }

  // check if username is already taken
  const usernameMatch = await admin
    .firestore()
    .collection("profiles")
    .doc(data.username)
    .get();
  if (usernameMatch.exists) {
    throw new functions.https.HttpsError(
      "already-exists",
      "This username is already taken!"
    );
  }

  // flag user as admin if necessary
  const user = await admin.auth().getUser(context.auth.uid);
  if (user.email === functions.config().accounts.admin) {
    await admin.auth().setCustomUserClaims(context.auth.uid, { admin: true });
  }

  return admin.firestore().collection("profiles").doc(data.username).set({
    userId: context.auth.uid,
  });
});

exports.createBook = functions.https.onCall(async (data, context) => {
  verifyAuthenticated(context, true);
  validateData(data, {
    title: "string",
    authorId: "string",
    coverImage: "string",
    summary: "string",
  });

  const mimeType = data.coverImage.match(
    /data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/
  )[1];
  const base64EncodedImageString = data.coverImage.replace(
    /^data:image\/\w+;base64,/,
    ""
  );
  const imageBuffer = new Buffer(base64EncodedImageString, "base64");

  const filename = `coverImages/${data.title}.${mimeTypes.extension(mimeType)}`;
  const file = admin.storage().bucket().file(filename);
  await file.save(imageBuffer, { contentType: "image/jpeg" });
  const fileUrl = await file
    .getSignedUrl({ action: "read", expires: "03-09-2491" })
    .then((urls) => urls[0]);

  return admin
    .firestore()
    .collection("books")
    .add({
      title: data.title,
      coverImageUrl: fileUrl,
      author: admin.firestore().collection("authors").doc(data.authorId),
      summary: data.summary,
    })
    .then((docRef) => docRef.id)
    .catch((error) => error);
});

exports.postComment = functions.https.onCall(async (data, context) => {
  verifyAuthenticated(context);
  validateData(data, {
    bookId: "string",
    text: "string",
  });
  const db = admin.firestore();
  const snapshot = await db
    .collection("profiles")
    .where("userId", "==", context.auth.uid)
    .limit(1)
    .get();
  await db.collection("comments").add({
    text: data.text,
    username: snapshot.docs[0].id,
    dateCreated: new Date(),
    book: db.collection("books").doc(data.bookId),
  });
});

function verifyAuthenticated(context, requireAdmin) {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "You must be logged in to use this feature!"
    );
  } else if (requireAdmin && !context.auth.token.admin) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "You must be an admin to use this feature!"
    );
  }
}

function validateData(data, validKeys) {
  if (Object.keys(data).length !== Object.keys(validKeys).length) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Request payload contains an invalid number of keys!"
    );
  } else {
    for (let key in data) {
      if (!validKeys[key] || typeof key !== validKeys[key]) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Request payload contains invalid properties!"
        );
      }
    }
  }
}
