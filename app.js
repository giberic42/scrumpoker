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

const POINT_CARDS = [
  { id: "question", label: "?", numericValue: 0 },
  { id: "coffee", label: "\u2615", numericValue: 0 },
  { id: "0", label: "0", numericValue: 0 },
  { id: "1", label: "1", numericValue: 1 },
  { id: "2", label: "2", numericValue: 2 },
  { id: "3", label: "3", numericValue: 3 },
  { id: "5", label: "5", numericValue: 5 },
  { id: "8", label: "8", numericValue: 8 },
  { id: "13", label: "13", numericValue: 13 },
  { id: "20", label: "20", numericValue: 20 },
  { id: "40", label: "40", numericValue: 40 },
  { id: "100", label: "100", numericValue: 100 }
];
const POINT_VALUES = [0, 1, 2, 3, 5, 8, 13, 20, 40, 100];
const HEARTBEAT_INTERVAL_MS = 30000;
const STALE_TIMEOUT_MS = 90000;
const CLEAR_ANIMATION_MS = 720;
const PLACEHOLDER_VALUES = new Set([
  "REPLACE_ME",
  "REPLACE_ME.firebaseapp.com",
  "REPLACE_ME.appspot.com"
]);
const THEME_STORAGE_KEY = "scrum-poker-theme";
const SESSION_STORAGE_KEY = "scrum-poker-session";

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
  clearOverlay: document.getElementById("clearOverlay"),
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
  busy: false,
  resumeAttempted: false,
  heartbeatIntervalId: null,
  staleCleanupIntervalId: null
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
      if (user) {
        void resumePreviousSession();
      }
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
        createdAt: now,
        updatedAt: now
      });
    }

    await upsertParticipant(roomKey, name);
    await enterRoom(roomId, roomKey, name);
    saveSession({
      name,
      roomId,
      passphrase
    });
    showMessage(
      roomSnapshot.exists()
        ? `Joined room "${roomId}".`
        : `Created room "${roomId}".`,
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
  startPresenceLoops();
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
      lastSeenAt: now,
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
    showMessage("Join the room before changing reveal state.", "error");
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
    showMessage("Join the room before clearing votes.", "error");
    return;
  }

  try {
    refs.clearOverlay.classList.remove("active");
    refs.boardSection.querySelector(".board")?.classList.add("clearing");
    void refs.clearOverlay.offsetWidth;
    refs.clearOverlay.classList.add("active");
    await delay(CLEAR_ANIMATION_MS);

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
  } finally {
    refs.boardSection.querySelector(".board")?.classList.remove("clearing");
    refs.clearOverlay.classList.remove("active");
  }
}

async function removeParticipant(participantId) {
  if (!state.roomKey) {
    return;
  }

  if (!canManageRoom()) {
    showMessage("Join the room before removing someone.", "error");
    return;
  }

  try {
    await removeParticipantInternal(participantId);
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
  stopPresenceLoops();

  state.roomId = "";
  state.roomKey = "";
  state.roomData = null;
  state.participants = [];
  state.resumeAttempted = true;

  refs.boardSection.classList.remove("show");
  refs.setupSection.style.display = "grid";
  resetStats();
  clearInviteUrl();
  clearSavedSession();
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

function stopPresenceLoops() {
  if (state.heartbeatIntervalId) {
    clearInterval(state.heartbeatIntervalId);
    state.heartbeatIntervalId = null;
  }

  if (state.staleCleanupIntervalId) {
    clearInterval(state.staleCleanupIntervalId);
    state.staleCleanupIntervalId = null;
  }
}

function startPresenceLoops() {
  stopPresenceLoops();
  void touchPresence();
  state.heartbeatIntervalId = window.setInterval(() => {
    void touchPresence();
  }, HEARTBEAT_INTERVAL_MS);
  state.staleCleanupIntervalId = window.setInterval(() => {
    void cleanupStaleParticipants();
  }, HEARTBEAT_INTERVAL_MS);
}

async function touchPresence() {
  if (!state.roomKey || !state.user) {
    return;
  }

  try {
    await setDoc(
      doc(db, "rooms", state.roomKey, "participants", state.user.uid),
      {
        lastSeenAt: Date.now(),
        updatedAt: Date.now()
      },
      { merge: true }
    );
  } catch (error) {
    console.error(error);
  }
}

async function cleanupStaleParticipants() {
  if (!canManageRoom() || !state.participants.length) {
    return;
  }

  const staleParticipants = state.participants.filter((participant) => {
    if (participant.id === state.user?.uid) {
      return false;
    }

    const lastSeenAt = Number(participant.lastSeenAt || 0);
    return lastSeenAt > 0 && Date.now() - lastSeenAt > STALE_TIMEOUT_MS;
  });

  if (!staleParticipants.length) {
    return;
  }

  for (const participant of staleParticipants) {
    await removeParticipantInternal(participant.id, { silent: true, stale: true });
  }
}

function canManageRoom() {
  return Boolean(
    state.user &&
    state.roomKey &&
    state.participants.some((participant) => participant.id === state.user.uid)
  );
}

async function removeParticipantInternal(participantId, options = {}) {
  const participant = state.participants.find((entry) => entry.id === participantId);

  await deleteDoc(doc(db, "rooms", state.roomKey, "participants", participantId));

  if (!options.silent && participant) {
    showMessage(
      options.stale
        ? `${participant.name} was removed after going inactive.`
        : `${participant.name} was removed from the room.`,
      "success"
    );
  }
}

function render() {
  const participants = state.participants;
  refs.voteDeck.innerHTML = "";
  refs.participantsTableBody.innerHTML = "";
  refs.emptyState.hidden = participants.length > 0;

  const currentUserId = state.user?.uid;
  const revealVotes = Boolean(state.roomData?.revealVotes);
  const numericVotes = participants
    .map((participant) => getVoteNumericValue(participant.vote))
    .filter((vote) => Number.isFinite(vote));

  const currentUser = participants.find((participant) => participant.id === currentUserId) ?? null;
  renderVoteDeck(currentUser);

  if (!participants.length) {
    resetStats();
    return;
  }

  participants.forEach((participant) => {
    const isSelf = participant.id === currentUserId;

    let voteText = "-";
    let voteClass = "story-pill hidden";
    if (participant.vote !== null && participant.vote !== undefined && participant.vote !== "") {
      voteText = revealVotes ? getVoteLabel(participant.vote) : "Hidden";
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
    if (isSelf) {
      badges.appendChild(createBadge("You"));
    }

    const controls = row.querySelector(".table-actions");
    if (isSelf) {
      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "mini-btn";
      renameBtn.textContent = "Rename";
      renameBtn.addEventListener("click", () => renameCurrentParticipant(participant.name || ""));
      controls.appendChild(renameBtn);

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
      removeBtn.textContent = "Kick";
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
  POINT_CARDS.forEach((option) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "vote-card";
    card.textContent = option.label;
    card.disabled = !currentUser;

    if (currentUser?.vote === option.id) {
      card.classList.add("selected");
    }

    card.addEventListener("click", () => setVote(option.id));
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
  refs.hostState.textContent = canManageRoom() ? "Room Controls Enabled" : "Participant View";
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

async function resumePreviousSession() {
  if (state.resumeAttempted || state.roomKey || state.busy) {
    return;
  }

  state.resumeAttempted = true;
  const savedSession = getSavedSession();
  const inviteData = parseInviteHash();

  const roomId = normalizeRoomId(inviteData.roomId || savedSession.roomId || "");
  const passphrase = normalizePassphrase(inviteData.passphrase || savedSession.passphrase || "");
  const name = normalizeName(savedSession.name || refs.displayName.value || "");

  if (!roomId || !passphrase || !name) {
    return;
  }

  refs.displayName.value = name;
  refs.roomIdInput.value = roomId;
  refs.passphraseInput.value = passphrase;

  try {
    state.busy = true;
    toggleBusyState();

    const roomKey = await deriveRoomKey(roomId, passphrase);
    const roomRef = doc(db, "rooms", roomKey);
    const roomSnapshot = await getDoc(roomRef);

    if (!roomSnapshot.exists()) {
      clearSavedSession();
      return;
    }

    await upsertParticipant(roomKey, name);
    await enterRoom(roomId, roomKey, name);
    saveSession({ name, roomId, passphrase });
    showMessage(`Rejoined room "${roomId}".`, "success");
  } catch (error) {
    console.error(error);
    clearSavedSession();
    showMessage("Could not resume the previous room automatically.", "error");
  } finally {
    state.busy = false;
    toggleBusyState();
  }
}

function toggleTheme() {
  const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
  document.body.dataset.theme = nextTheme;
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  refs.themeToggleBtn.textContent = nextTheme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode";
}

function saveSession(session) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function getSavedSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "{}");
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      roomId: typeof parsed.roomId === "string" ? parsed.roomId : "",
      passphrase: typeof parsed.passphrase === "string" ? parsed.passphrase : ""
    };
  } catch {
    return { name: "", roomId: "", passphrase: "" };
  }
}

function clearSavedSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
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

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatAverage(votes) {
  if (!votes.length) {
    return "-";
  }

  const average = votes.reduce((sum, vote) => sum + vote, 0) / votes.length;
  return String(findClosestStoryPoint(average));
}

function getVoteLabel(vote) {
  return POINT_CARDS.find((card) => card.id === vote)?.label ?? vote ?? "-";
}

function getVoteNumericValue(vote) {
  if (vote === null || vote === undefined || vote === "") {
    return Number.NaN;
  }

  return POINT_CARDS.find((card) => card.id === vote)?.numericValue ?? Number(vote);
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

async function renameCurrentParticipant(currentName) {
  if (!state.roomKey || !state.user) {
    return;
  }

  const nextName = normalizeName(window.prompt("Update your display name", currentName) ?? "");
  if (!nextName) {
    return;
  }

  try {
    await setDoc(
      doc(db, "rooms", state.roomKey, "participants", state.user.uid),
      {
        name: nextName,
        updatedAt: Date.now()
      },
      { merge: true }
    );
    refs.displayName.value = nextName;
    showMessage("Name updated.", "success");
  } catch (error) {
    console.error(error);
    showMessage(`Could not update your name: ${error.message}`, "error");
  }
}

function showMessage(text, type = "") {
  refs.message.textContent = text;
  refs.message.className = `message show ${type}`.trim();
}
