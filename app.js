import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const POINT_OPTIONS = ["0", "1", "2", "3", "5", "8", "13", "21"];
const POINT_VALUES = POINT_OPTIONS.map((value) => Number(value));
const PLACEHOLDER_VALUES = new Set([
  "REPLACE_ME",
  "REPLACE_ME.firebaseapp.com",
  "REPLACE_ME.appspot.com"
]);
const THEME_STORAGE_KEY = "scrum-poker-theme";

const refs = {
  authStatus: document.getElementById("authStatus"),
  participantCount: document.getElementById("participantCount"),
  voteCount: document.getElementById("voteCount"),
  revealState: document.getElementById("revealState"),
  averageValue: document.getElementById("averageValue"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  message: document.getElementById("message"),
  setupSection: document.getElementById("setupSection"),
  boardSection: document.getElementById("boardSection"),
  roomIdLabel: document.getElementById("roomIdLabel"),
  roomSummary: document.getElementById("roomSummary"),
  hostState: document.getElementById("hostState"),
  voteDeck: document.getElementById("voteDeck"),
  participantsTableBody: document.getElementById("participantsTableBody"),
  emptyState: document.getElementById("emptyState"),
  displayName: document.getElementById("displayName"),
  roomIdInput: document.getElementById("roomIdInput"),
  passphraseInput: document.getElementById("passphraseInput"),
  enterRoomBtn: document.getElementById("enterRoomBtn"),
  prefillFromLinkBtn: document.getElementById("prefillFromLinkBtn"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  toggleRevealBtn: document.getElementById("toggleRevealBtn"),
  clearVotesBtn: document.getElementById("clearVotesBtn"),
  leaveRoomBtn: document.getElementById("leaveRoomBtn")
};

const state = {
  appReady: false,
  authReady: false,
  user: null,
  roomId: "",
  roomKey: "",
  roomData: null,
  participants: [],
  unsubscribers: [],
  busy: false
};

let db = null;
let auth = null;

bindUi();
bootstrap();

function bindUi() {
  applySavedTheme();
  refs.enterRoomBtn.addEventListener("click", () => enterOrCreateRoom());
  refs.prefillFromLinkBtn.addEventListener("click", () => prefillRoomIdFromUrl(true));
  refs.copyLinkBtn.addEventListener("click", () => copyInviteLink());
  refs.toggleRevealBtn.addEventListener("click", () => toggleReveal());
  refs.clearVotesBtn.addEventListener("click", () => clearVotes());
  refs.leaveRoomBtn.addEventListener("click", () => leaveRoom());
  refs.themeToggleBtn.addEventListener("click", () => toggleTheme());

  [refs.displayName, refs.roomIdInput, refs.passphraseInput].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        enterOrCreateRoom();
      }
    });
  });
}

async function bootstrap() {
  prefillRoomIdFromUrl(false);

  if (!isFirebaseConfigured()) {
    refs.authStatus.textContent = "Firebase setup needed";
    showMessage(
      "Update firebase-config.js with your Firebase project values before using the shared room features.",
      "error"
    );
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    state.appReady = true;

    await signInAnonymously(auth);

    onAuthStateChanged(auth, (user) => {
      state.user = user;
      state.authReady = Boolean(user);
      refs.authStatus.textContent = user ? "Connected to Firebase" : "Waiting for auth";
      updateBoardHeader();
    });
  } catch (error) {
    console.error(error);
    refs.authStatus.textContent = "Firebase connection failed";
    showMessage(`Firebase setup failed: ${error.message}`, "error");
  }
}

function isFirebaseConfigured() {
  return Object.values(firebaseConfig).every((value) => typeof value === "string" && !PLACEHOLDER_VALUES.has(value));
}

function prefillRoomIdFromUrl(showFeedback) {
  const roomFromUrl = new URLSearchParams(window.location.search).get("room");
  const inviteData = parseInviteHash();

  if (!roomFromUrl && !inviteData.roomId) {
    if (showFeedback) {
      showMessage("No room details were found in the current link.", "error");
    }
    return;
  }

  const roomId = normalizeRoomId(inviteData.roomId || roomFromUrl || "");
  if (roomId) {
    refs.roomIdInput.value = roomId;
  }

  if (inviteData.passphrase) {
    refs.passphraseInput.value = inviteData.passphrase;
  }

  if (showFeedback) {
    showMessage(
      inviteData.passphrase
        ? `Loaded room "${roomId}" and its invite passphrase from the link.`
        : `Loaded room ID "${roomId}" from the link.`,
      "success"
    );
  }
}

async function ensureReady() {
  if (!state.appReady) {
    showMessage("Firebase is not configured yet. Update firebase-config.js first.", "error");
    return false;
  }

  if (!state.authReady || !state.user) {
    showMessage("Authentication is still starting. Try again in a moment.", "error");
    return false;
  }

  return true;
}

async function enterOrCreateRoom() {
  if (!(await ensureReady()) || state.busy) {
    return;
  }

  const name = normalizeName(refs.displayName.value);
  const roomId = normalizeRoomId(refs.roomIdInput.value);
  const passphrase = normalizePassphrase(refs.passphraseInput.value);

  if (!validateRoomInputs({ name, roomId, passphrase })) {
    return;
  }

  state.busy = true;
  toggleBusyState();

  try {
    const roomKey = await deriveRoomKey(roomId, passphrase);
    const roomRef = doc(db, "rooms", roomKey);
    const roomSnapshot = await getDoc(roomRef);

    if (!roomSnapshot.exists()) {
      const now = Date.now();
      await setDoc(roomRef, {
        roomId,
        revealVotes: false,
        hostUid: state.user.uid,
        createdAt: now,
        updatedAt: now
      });
    }

    await upsertParticipant(roomKey, name);
    await enterRoom(roomId, roomKey, name);
    showMessage(
      roomSnapshot.exists()
        ? `Joined room "${roomId}".`
        : `Created room "${roomId}" and joined as host.`,
      "success"
    );
  } catch (error) {
    console.error(error);
    showMessage(
      `Could not enter room. Double-check the room ID and passphrase. ${error.message}`,
      "error"
    );
  } finally {
    state.busy = false;
    toggleBusyState();
  }
}

function validateRoomInputs({ name, roomId, passphrase }) {
  if (!name) {
    showMessage("Enter your name first.", "error");
    return false;
  }

  if (!roomId) {
    showMessage("Enter a room ID first.", "error");
    return false;
  }

  if (!passphrase) {
    showMessage("Enter a session passphrase first.", "error");
    return false;
  }

  return true;
}

async function enterRoom(roomId, roomKey, participantName) {
  cleanupSubscriptions();

  state.roomId = roomId;
  state.roomKey = roomKey;
  state.participants = [];
  state.roomData = null;

  refs.displayName.value = participantName;
  refs.roomIdInput.value = roomId;

  const roomRef = doc(db, "rooms", roomKey);
  const participantsRef = collection(roomRef, "participants");

  state.unsubscribers.push(
    onSnapshot(roomRef, (snapshot) => {
      if (!snapshot.exists()) {
        showMessage("This room no longer exists.", "error");
        leaveRoom(false);
        return;
      }

      state.roomData = snapshot.data();
      updateBoardHeader();
      render();
    })
  );

  state.unsubscribers.push(
    onSnapshot(participantsRef, (snapshot) => {
      state.participants = snapshot.docs
        .map((participant) => ({ id: participant.id, ...participant.data() }))
        .sort((left, right) => {
          const leftTime = Number(left.joinedAt || 0);
          const rightTime = Number(right.joinedAt || 0);
          return leftTime - rightTime || String(left.name).localeCompare(String(right.name));
        });

      render();
    })
  );

  refs.setupSection.style.display = "none";
  refs.boardSection.classList.add("show");
  setInviteUrl(roomId, refs.passphraseInput.value);
}

async function upsertParticipant(roomKey, name) {
  const participantRef = doc(db, "rooms", roomKey, "participants", state.user.uid);
  const existing = await getDoc(participantRef);
  const now = Date.now();

  await setDoc(
    participantRef,
    {
      uid: state.user.uid,
      name,
      vote: existing.exists() ? existing.data().vote ?? null : null,
      joinedAt: existing.exists() ? existing.data().joinedAt ?? now : now,
      updatedAt: now
    },
    { merge: true }
  );
}

async function setVote(vote) {
  if (!state.roomKey || !state.user) {
    return;
  }

  try {
    await setDoc(
      doc(db, "rooms", state.roomKey, "participants", state.user.uid),
      {
        uid: state.user.uid,
        vote,
        updatedAt: Date.now()
      },
      { merge: true }
    );
  } catch (error) {
    console.error(error);
    showMessage(`Could not save vote: ${error.message}`, "error");
  }
}

async function toggleReveal() {
  if (!canManageRoom()) {
    showMessage("Only the room host can reveal or hide votes.", "error");
    return;
  }

  try {
    await updateDoc(doc(db, "rooms", state.roomKey), {
      revealVotes: !Boolean(state.roomData?.revealVotes),
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error(error);
    showMessage(`Could not update reveal state: ${error.message}`, "error");
  }
}

async function clearVotes() {
  if (!canManageRoom()) {
    showMessage("Only the room host can clear votes.", "error");
    return;
  }

  try {
    const batch = writeBatch(db);
    const now = Date.now();

    state.participants.forEach((participant) => {
      batch.set(
        doc(db, "rooms", state.roomKey, "participants", participant.id),
        {
          vote: null,
          updatedAt: now
        },
        { merge: true }
      );
    });

    batch.set(
      doc(db, "rooms", state.roomKey),
      {
        revealVotes: false,
        updatedAt: now
      },
      { merge: true }
    );

    await batch.commit();
  } catch (error) {
    console.error(error);
    showMessage(`Could not clear votes: ${error.message}`, "error");
  }
}

async function removeParticipant(participantId) {
  if (!state.roomKey) {
    return;
  }

  const isSelf = participantId === state.user?.uid;
  if (!isSelf && !canManageRoom()) {
    showMessage("Only the host can remove other participants.", "error");
    return;
  }

  try {
    await deleteDoc(doc(db, "rooms", state.roomKey, "participants", participantId));
  } catch (error) {
    console.error(error);
    showMessage(`Could not remove participant: ${error.message}`, "error");
  }
}

async function leaveRoom(showFeedback = true) {
  const previousRoomId = state.roomId;
  const currentUid = state.user?.uid;
  const currentRoomKey = state.roomKey;

  cleanupSubscriptions();

  state.roomId = "";
  state.roomKey = "";
  state.roomData = null;
  state.participants = [];

  refs.boardSection.classList.remove("show");
  refs.setupSection.style.display = "grid";
  resetStats();
  clearInviteUrl();
  render();

  if (currentUid && currentRoomKey) {
    try {
      await deleteDoc(doc(db, "rooms", currentRoomKey, "participants", currentUid));
    } catch (error) {
      console.error(error);
    }
  }

  if (showFeedback && previousRoomId) {
    showMessage(`Left room "${previousRoomId}".`, "success");
  }
}

function cleanupSubscriptions() {
  state.unsubscribers.forEach((unsubscribe) => unsubscribe());
  state.unsubscribers = [];
}

function canManageRoom() {
  return Boolean(state.user && state.roomData && state.roomData.hostUid === state.user.uid);
}

function render() {
  const participants = state.participants;
  refs.voteDeck.innerHTML = "";
  refs.participantsTableBody.innerHTML = "";
  refs.emptyState.hidden = participants.length > 0;

  const currentUserId = state.user?.uid;
  const revealVotes = Boolean(state.roomData?.revealVotes);
  const numericVotes = participants
    .map((participant) => Number(participant.vote))
    .filter((vote) => Number.isFinite(vote));

  const currentUser = participants.find((participant) => participant.id === currentUserId) ?? null;
  renderVoteDeck(currentUser);

  if (!participants.length) {
    resetStats();
    return;
  }

  participants.forEach((participant) => {
    const isSelf = participant.id === currentUserId;
    const isHost = participant.id === state.roomData?.hostUid;

    let voteText = "-";
    let voteClass = "story-pill hidden";
    if (participant.vote !== null && participant.vote !== undefined && participant.vote !== "") {
      voteText = revealVotes ? participant.vote : "Hidden";
      voteClass = revealVotes ? "story-pill" : "story-pill hidden";
    }

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <div class="name-stack">
          <div class="name-line"></div>
          <div class="name-meta"></div>
        </div>
      </td>
      <td class="story-points-cell">
        <span class="${voteClass}">${voteText}</span>
      </td>
      <td class="story-points-cell">
        <div class="table-actions"></div>
      </td>
    `;

    row.querySelector(".name-line").textContent = participant.name || "Unnamed";

    const badges = row.querySelector(".name-meta");
    if (isHost) {
      badges.appendChild(createBadge("Host", "host"));
    }
    if (isSelf) {
      badges.appendChild(createBadge("You"));
    }

    const controls = row.querySelector(".table-actions");
    if (isSelf) {
      const removeSelfBtn = document.createElement("button");
      removeSelfBtn.type = "button";
      removeSelfBtn.className = "mini-btn";
      removeSelfBtn.textContent = "Leave";
      removeSelfBtn.addEventListener("click", () => leaveRoom());
      controls.appendChild(removeSelfBtn);
    } else if (canManageRoom()) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "mini-btn";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => removeParticipant(participant.id));
      controls.appendChild(removeBtn);
    }

    refs.participantsTableBody.appendChild(row);
  });

  refs.participantCount.textContent = String(participants.length);
  refs.voteCount.textContent = String(participants.filter((participant) => participant.vote !== null && participant.vote !== "").length);
  refs.revealState.textContent = revealVotes ? "Shown" : "Hidden";
  refs.averageValue.textContent = revealVotes ? formatAverage(numericVotes) : "Hidden";
  refs.toggleRevealBtn.textContent = revealVotes ? "Hide Votes" : "Show Votes";
  refs.toggleRevealBtn.disabled = !canManageRoom();
  refs.clearVotesBtn.disabled = !canManageRoom();
}

function renderVoteDeck(currentUser) {
  POINT_OPTIONS.forEach((option) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "vote-card";
    card.textContent = option;
    card.disabled = !currentUser;

    if (currentUser?.vote === option) {
      card.classList.add("selected");
    }

    card.addEventListener("click", () => setVote(option));
    refs.voteDeck.appendChild(card);
  });
}

function createBadge(text, className = "") {
  const badge = document.createElement("span");
  badge.className = `badge ${className}`.trim();
  badge.textContent = text;
  return badge;
}

function updateBoardHeader() {
  const roomId = state.roomId || "-";
  refs.roomIdLabel.textContent = roomId;
  refs.hostState.textContent = canManageRoom() ? "Host Controls Enabled" : "Participant View";
  refs.roomSummary.textContent = state.roomId
    ? `Share this room as ${buildInviteUrl(state.roomId)}`
    : "Live Firestore room with hidden voting until reveal.";
}

function resetStats() {
  refs.participantCount.textContent = "0";
  refs.voteCount.textContent = "0";
  refs.revealState.textContent = "Hidden";
  refs.averageValue.textContent = "-";
  refs.toggleRevealBtn.disabled = true;
  refs.clearVotesBtn.disabled = true;
  refs.toggleRevealBtn.textContent = "Show Votes";
}

function applySavedTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const theme = savedTheme === "dark" ? "dark" : "light";
  document.body.dataset.theme = theme;
  refs.themeToggleBtn.textContent = theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode";
}

function toggleTheme() {
  const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
  document.body.dataset.theme = nextTheme;
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  refs.themeToggleBtn.textContent = nextTheme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode";
}

function toggleBusyState() {
  const disabled = state.busy;
  refs.enterRoomBtn.disabled = disabled;
}

function normalizeName(value) {
  return value.trim().replace(/\s+/g, " ").slice(0, 40);
}

function normalizeRoomId(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 40);
}

function normalizePassphrase(value) {
  return value.trim();
}

function formatAverage(votes) {
  if (!votes.length) {
    return "-";
  }

  const average = votes.reduce((sum, vote) => sum + vote, 0) / votes.length;
  return String(findClosestStoryPoint(average));
}

function findClosestStoryPoint(target) {
  return POINT_VALUES.reduce((closest, candidate) => {
    const candidateDistance = Math.abs(candidate - target);
    const closestDistance = Math.abs(closest - target);

    if (candidateDistance < closestDistance) {
      return candidate;
    }

    // If the mean falls directly between two cards, bias upward.
    if (candidateDistance === closestDistance && candidate > closest) {
      return candidate;
    }

    return closest;
  }, POINT_VALUES[0]);
}

async function deriveRoomKey(roomId, passphrase) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${roomId}::${passphrase}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function setInviteUrl(roomId, passphrase) {
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  url.hash = roomId
    ? new URLSearchParams({
        room: roomId,
        passphrase
      }).toString()
    : "";
  window.history.replaceState({}, "", url);
}

function buildInviteUrl(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  url.hash = new URLSearchParams({
    room: roomId,
    passphrase: refs.passphraseInput.value
  }).toString();
  return url.toString();
}

function clearInviteUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  url.hash = "";
  window.history.replaceState({}, "", url);
}

function parseInviteHash() {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(hash);

  return {
    roomId: params.get("room") ?? "",
    passphrase: params.get("passphrase") ?? ""
  };
}

async function copyInviteLink() {
  if (!state.roomId) {
    showMessage("Join or create a room first.", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(buildInviteUrl(state.roomId));
    showMessage("Invite link copied. It includes the room ID and passphrase in the link hash.", "success");
  } catch (error) {
    console.error(error);
    showMessage("Could not copy the invite link in this browser.", "error");
  }
}

function showMessage(text, type = "") {
  refs.message.textContent = text;
  refs.message.className = `message show ${type}`.trim();
}
