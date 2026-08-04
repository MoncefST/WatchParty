/* WatchParty — a small, real-data flow: Google → room → swipe → watch. */

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const config = window.WATCHPARTY_CONFIG || {};
const GOOGLE_CLIENT_ID = config.googleClientId || "";
const YOUTUBE_API_KEY = config.youtubeApiKey || "";
const GOOGLE_SCOPE = "openid profile email https://www.googleapis.com/auth/youtube.readonly";
const STORAGE_KEY = "watchparty-simple-state";

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
const initials = (name = "") => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
const makeCode = () => { const bytes = new Uint8Array(4); crypto.getRandomValues(bytes); return [...bytes].map((byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 6).toUpperCase(); };
const getRoomFromHash = () => new URLSearchParams(window.location.hash.slice(1)).get("room")?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "";
const formatDate = (date = new Date()) => new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
const formatTime = (seconds) => { if (!Number.isFinite(seconds)) return "00:00"; return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`; };
const getVideoIdFromUrl = (value) => { try { const url = new URL(value); if (url.hostname.includes("youtu.be")) return url.pathname.slice(1).split("/")[0]; if (url.hostname.includes("youtube.com")) { if (url.pathname === "/watch") return url.searchParams.get("v"); if (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2]; } } catch (_) { return null; } return null; };

let persisted = {};
try { persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch (_) { persisted = {}; }

const state = {
  user: null,
  accessToken: "",
  stats: { subscriptions: 0, likes: 0, updated: "—" },
  channels: [],
  recommendations: [],
  recommendationSource: "",
  roomCode: getRoomFromHash() || persisted.roomCode || "",
  role: sessionStorage.getItem("watchparty-role") || "",
  sessionId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
  partner: null,
  decisions: { host: {}, guest: {} },
  matches: [],
  activeStep: "account",
};

let roomChannel = null;
let googleTokenClient = null;
let youtubePlayer = null;
let youtubeReady = false;
let applyingRemoteState = false;
let muted = false;
let toastTimer;
let selectedVideoId = null;

const toast = (message) => { const node = $("#toast"); node.textContent = message; node.classList.add("visible"); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove("visible"), 2800); };
const setFeedback = (message) => { $("#welcomeFeedback").textContent = message; };
const persistRoom = () => localStorage.setItem(STORAGE_KEY, JSON.stringify({ roomCode: state.roomCode }));
const send = (type, payload = {}) => roomChannel?.postMessage({ type, ...payload, sender: state.sessionId, sentAt: Date.now() });

const setActiveStep = (step) => {
  state.activeStep = step;
  $$(".flow-step").forEach((button) => button.classList.toggle("is-active", button.dataset.step === step));
  $$("[data-panel]").forEach((panel) => { const visible = panel.dataset.panel === step; panel.hidden = !visible; panel.classList.toggle("is-visible", visible); });
  if (step === "swipe") renderSwipe();
  if (step === "watch") updateWatchMeta();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

const showApp = () => { $("#welcomeView").hidden = true; $("#appView").hidden = false; $("#headerLogin").hidden = true; $("#headerUser").hidden = false; setActiveStep(state.activeStep); };
const showWelcome = () => { $("#welcomeView").hidden = false; $("#appView").hidden = true; $("#headerLogin").hidden = false; $("#headerUser").hidden = true; };

const renderAccount = () => {
  const user = state.user;
  if (!user) return;
  const avatar = $("#accountAvatar");
  avatar.src = user.picture || `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="24" fill="#ffe36e"/><text x="50%" y="58%" text-anchor="middle" font-size="36" font-family="Arial" fill="#162026">${initials(user.name)}</text></svg>`)}`;
  avatar.alt = user.name;
  $("#accountName").textContent = user.name;
  $("#accountEmail").textContent = user.email;
  $("#helloTitle").textContent = `Salut ${user.name.split(" ")[0]}.`;
  $("#headerUser").textContent = user.name.split(" ")[0];
  $("#memberYouAvatar").textContent = initials(user.name);
  $("#memberYouName").textContent = user.name.split(" ")[0];
  $("#statSubscriptions").textContent = state.stats.subscriptions || "0";
  $("#statLikes").textContent = state.stats.likes || "0";
  $("#statUpdated").textContent = state.stats.updated;
  $("#channelList").innerHTML = state.channels.length ? state.channels.slice(0, 5).map((channel) => `<span class="channel-pill">${escapeHtml(channel)}</span>`).join("") : `<span class="muted-line">Aucune chaîne remontée par YouTube.</span>`;
  $("#accountNote").textContent = state.recommendationSource || "Les données affichées viennent de ton compte. Rien n’est inventé.";
};

const renderRoom = () => {
  const hasRoom = Boolean(state.roomCode);
  $("#roomInvite").hidden = !hasRoom;
  $("#roomCode").textContent = state.roomCode || "—";
  $("#joinCode").value = state.roomCode || "";
  $("#partnerStatus").textContent = state.partner ? `${state.partner.name.split(" ")[0]} est là` : "en attente du lien";
  $(".member-waiting").classList.toggle("is-ready", Boolean(state.partner));
  if (state.partner) { $(".member-waiting .member-avatar").textContent = initials(state.partner.name); $(".member-waiting .member-pulse").textContent = "✓"; }
};

const connectRoomChannel = () => {
  roomChannel?.close();
  if (!(state.roomCode && "BroadcastChannel" in window)) return;
  roomChannel = new BroadcastChannel(`watchparty:${state.roomCode}`);
  roomChannel.addEventListener("message", ({ data }) => {
    if (!data || data.sender === state.sessionId) return;
    if (data.type === "hello") { state.partner = data.user; renderRoom(); send("hello", { user: publicUser() }); return; }
    if (data.type === "decision") handleRemoteDecision(data);
    if (data.type === "watch") applyRemoteWatch(data);
  });
  send("hello", { user: publicUser() });
};

const publicUser = () => state.user ? { name: state.user.name, picture: state.user.picture || "" } : { name: "Invité" };
const openRoom = (code, role) => {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (normalized.length < 4) return toast("Le code doit contenir au moins 4 caractères.");
  state.roomCode = normalized;
  state.role = role;
  sessionStorage.setItem("watchparty-role", role);
  state.decisions = { host: {}, guest: {} };
  state.matches = [];
  persistRoom();
  history.replaceState(null, "", `${window.location.pathname}#room=${normalized}`);
  connectRoomChannel();
  renderRoom();
  toast(role === "host" ? "Partie créée. Envoie le code à ton amie." : "Tu as rejoint la partie.");
};

const createRoom = () => openRoom(makeCode(), "host");
const joinRoom = () => openRoom($("#joinCode").value, "guest");
const inviteUrl = () => `${window.location.origin}${window.location.pathname}#room=${state.roomCode}`;
const copyInvite = async () => { if (!state.roomCode) return toast("Crée d’abord une partie."); const text = inviteUrl(); try { await navigator.clipboard.writeText(text); $("#copyFeedback").textContent = "Lien copié"; toast("Lien d’invitation copié."); } catch (_) { window.prompt("Copie ce lien", text); } setTimeout(() => { $("#copyFeedback").textContent = ""; }, 2600); };

const fetchYouTube = async (resource, params) => {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  if (YOUTUBE_API_KEY) url.searchParams.set("key", YOUTUBE_API_KEY);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${state.accessToken}` } });
  if (!response.ok) throw new Error("YouTube API indisponible");
  return response.json();
};

const meaningfulWords = (values) => {
  const ignored = new Set("avec pour dans les des une aux aux the and you your channel officiel official youtube video vidéos vlog de du le la et en un une est sur par from this that film films music musique".split(" "));
  const count = new Map();
  values.join(" ").toLowerCase().replace(/[^a-zà-ÿ0-9 ]/gi, " ").split(/\s+/).filter((word) => word.length > 3 && !ignored.has(word)).forEach((word) => count.set(word, (count.get(word) || 0) + 1));
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([word]) => word);
};

const toVideo = (item, id = item.id?.videoId || item.id) => ({ id, title: item.snippet?.title || "Vidéo YouTube", channel: item.snippet?.channelTitle || "YouTube", publishedAt: item.snippet?.publishedAt || "", thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });

const loadRecommendations = async (subscriptions, likes) => {
  const channelTitles = (subscriptions.items || []).map((item) => item.snippet?.title).filter(Boolean);
  const likedVideos = (likes.items || []).map((item) => toVideo(item));
  const query = meaningfulWords([...channelTitles, ...likedVideos.map((video) => video.title)]).join(" ");
  try {
    const result = await fetchYouTube("search", { part: "snippet", type: "video", maxResults: "12", order: "relevance", q: query || "film documentaire animation" });
    const videos = (result.items || []).map((item) => toVideo(item)).filter((video) => video.id);
    if (videos.length) { state.recommendationSource = `Recommandations générées à partir de ${state.stats.subscriptions} abonnements et ${state.stats.likes} likes YouTube.`; return videos; }
  } catch (_) { /* A disabled YouTube API should produce an honest empty state, not fake content. */ }
  if (likedVideos.length) { state.recommendationSource = "Voici tes vidéos aimées. Active YouTube Data API v3 pour générer des recommandations."; return likedVideos; }
  state.recommendationSource = "Google est connecté, mais YouTube ne renvoie pas encore de recommandations.";
  return [];
};

const loadGoogleAccount = async (accessToken) => {
  state.accessToken = accessToken;
  setFeedback("Lecture de ton compte YouTube…");
  const userResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!userResponse.ok) throw new Error("Impossible de récupérer le compte Google.");
  const user = await userResponse.json();
  state.user = { name: user.name || user.given_name || "Compte Google", email: user.email || "", picture: user.picture || "" };
  try {
    const [subscriptions, likes] = await Promise.all([fetchYouTube("subscriptions", { part: "snippet", mine: "true", maxResults: "50" }), fetchYouTube("videos", { part: "snippet", myRating: "like", maxResults: "50" })]);
    state.stats = { subscriptions: subscriptions.pageInfo?.totalResults || subscriptions.items?.length || 0, likes: likes.pageInfo?.totalResults || likes.items?.length || 0, updated: formatDate() };
    state.channels = (subscriptions.items || []).map((item) => item.snippet?.title).filter(Boolean);
    state.recommendations = await loadRecommendations(subscriptions, likes);
  } catch (_) {
    state.stats.updated = "profil seul";
    state.recommendations = [];
    state.recommendationSource = "Profil Google connecté. Active YouTube Data API v3 pour lire tes stats et tes recommandations.";
  }
  renderAccount();
  showApp();
  setFeedback("");
  toast(`Bienvenue ${state.user.name.split(" ")[0]}.`);
};

const connectGoogle = () => {
  if (!GOOGLE_CLIENT_ID) return setFeedback("Ajoute ton Client ID Google dans config.js.");
  if (!window.google?.accounts?.oauth2) return setFeedback("Google se charge encore. Réessaie dans une seconde.");
  googleTokenClient ||= window.google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: GOOGLE_SCOPE, callback: async (response) => { if (response.error) return setFeedback("Google a refusé l’accès. Vérifie que ton compte est autorisé comme testeur."); try { await loadGoogleAccount(response.access_token); } catch (error) { setFeedback(error.message); } } });
  googleTokenClient.requestAccessToken({ prompt: "select_account" });
};

const renderSwipeCard = (video) => {
  const card = $("#activeSwipeCard");
  selectedVideoId = video?.id || null;
  card.className = `swipe-card${video ? " has-video" : ""}`;
  card.innerHTML = video ? `<img src="${escapeHtml(video.thumbnail)}" alt="" /><div class="swipe-card-shade"></div><div class="swipe-card-copy"><span class="card-source">YOUTUBE · ${escapeHtml(video.channel)}</span><h3>${escapeHtml(video.title)}</h3><span class="card-action-hint">← passer &nbsp;&nbsp; garder →</span></div>` : "";
  card.tabIndex = video ? 0 : -1;
  $("#passButton").disabled = !video;
  $("#likeButton").disabled = !video;
};

const currentQueue = () => { const decisions = state.decisions[state.role || "host"] || {}; return state.recommendations.filter((video) => !decisions[video.id]); };
const renderSwipe = () => {
  const queue = currentQueue();
  const video = queue[0];
  $("#recommendationCount").textContent = String(state.recommendations.length);
  $("#swipeCount").textContent = `${video ? state.recommendations.length - queue.length + 1 : state.recommendations.length} / ${state.recommendations.length}`;
  $("#swipeEmpty").hidden = Boolean(video);
  $("#swipeEmptyText").textContent = state.recommendations.length ? "Tu as terminé cette sélection." : "Connecte YouTube pour charger tes recommandations.";
  renderSwipeCard(video);
  $("#sideMatch").hidden = !state.matches.length;
  if (state.matches.length) $("#sideMatchTitle").textContent = state.matches[0].title;
  bindGesture();
};

const renderMatch = (video) => { $("#sideMatch").hidden = false; $("#sideMatchTitle").textContent = video.title; $("#watchTitle").textContent = video.title; $("#watchMeta").textContent = `${video.channel} · match trouvé`; $("#sideMatchButton").onclick = () => openWatch(video); toast("Match trouvé ♥"); };
const finishDecision = (decision) => {
  const video = state.recommendations.find((item) => item.id === selectedVideoId);
  if (!video || !state.role) return toast("Crée ou rejoins une partie d’abord.");
  state.decisions[state.role][video.id] = decision;
  send("decision", { role: state.role, videoId: video.id, decision, video });
  const otherRole = state.role === "host" ? "guest" : "host";
  if (decision === "like" && state.decisions[otherRole][video.id] === "like") { if (!state.matches.some((match) => match.id === video.id)) state.matches.unshift(video); renderMatch(video); }
  renderSwipe();
};
const handleRemoteDecision = (data) => { if (!data.role || !data.videoId) return; state.partner = state.partner || { name: "Ton amie" }; state.decisions[data.role] ||= {}; state.decisions[data.role][data.videoId] = data.decision; const otherRole = data.role === "host" ? "guest" : "host"; if (data.decision === "like" && state.decisions[otherRole][data.videoId] === "like") { const video = state.recommendations.find((item) => item.id === data.videoId) || data.video; if (video && !state.matches.some((match) => match.id === video.id)) { state.matches.unshift(video); renderMatch(video); } } renderRoom(); renderSwipe(); };

const bindGesture = () => {
  const card = $("#activeSwipeCard");
  if (!selectedVideoId) return;
  let startX = 0; let dragging = false;
  card.onpointerdown = (event) => { dragging = true; startX = event.clientX; card.setPointerCapture?.(event.pointerId); card.classList.add("is-dragging"); };
  card.onpointermove = (event) => { if (!dragging) return; const delta = event.clientX - startX; card.style.transform = `translate(${delta}px, ${Math.max(-12, Math.min(12, delta * .08))}px) rotate(${delta / 15}deg)`; card.dataset.direction = delta > 0 ? "yes" : "no"; };
  card.onpointerup = (event) => { if (!dragging) return; dragging = false; const delta = event.clientX - startX; card.classList.remove("is-dragging"); card.style.transform = ""; card.dataset.direction = ""; if (Math.abs(delta) > 90) finishDecision(delta > 0 ? "like" : "pass"); };
  card.onpointercancel = () => { dragging = false; card.classList.remove("is-dragging"); card.style.transform = ""; };
};

const openWatch = (video) => { if (!video) return; $("#cassetteTitle").textContent = video.title; const overlay = $("#cassetteOverlay"); overlay.classList.add("is-visible"); setTimeout(() => overlay.classList.add("is-opening"), 40); setTimeout(() => { overlay.classList.remove("is-visible", "is-opening"); $("#watchTitle").textContent = video.title; $("#watchMeta").textContent = `${video.channel} · match trouvé`; $("#watchUrl").value = `https://youtu.be/${video.id}`; loadWatchVideo(video.id); setActiveStep("watch"); }, 850); };
const updateWatchMeta = () => { if (!state.matches.length) return; const video = state.matches[0]; $("#watchTitle").textContent = video.title; $("#watchMeta").textContent = `${video.channel} · match trouvé`; };

window.onYouTubeIframeAPIReady = () => { youtubePlayer = new YT.Player("youtubePlayer", { videoId: "", playerVars: { modestbranding: 1, rel: 0, playsinline: 1, controls: 0 }, events: { onReady: () => { youtubeReady = true; updateWatchTime(); }, onStateChange: (event) => { if (!applyingRemoteState && state.roomCode) { const action = event.data === YT.PlayerState.PLAYING ? "play" : event.data === YT.PlayerState.PAUSED ? "pause" : ""; if (action) send("watch", { action, time: youtubePlayer.getCurrentTime() }); } $("#watchPlayButton").textContent = event.data === YT.PlayerState.PLAYING ? "Ⅱ" : "▶"; } } }); };
const loadWatchVideo = (videoId, announce = true) => { if (!videoId) return toast("Ce lien YouTube n’est pas valide."); if (!youtubeReady) return toast("Le lecteur YouTube se prépare encore."); youtubePlayer.loadVideoById(videoId); $("#watchSyncLabel").textContent = "lecteur prêt"; if (announce) send("watch", { action: "load", videoId }); };
const updateWatchTime = () => { if (!youtubeReady || !youtubePlayer?.getDuration) return; const current = youtubePlayer.getCurrentTime() || 0; const duration = youtubePlayer.getDuration() || 0; $("#watchTimeline").value = duration ? current / duration * 100 : 0; $("#watchTime").textContent = `${formatTime(current)} / ${formatTime(duration)}`; };
const applyRemoteWatch = (data) => { if (!youtubeReady) return; applyingRemoteState = true; if (data.action === "load") youtubePlayer.loadVideoById(data.videoId); if (data.action === "play") { youtubePlayer.seekTo(data.time || 0, true); youtubePlayer.playVideo(); } if (data.action === "pause") { youtubePlayer.seekTo(data.time || 0, true); youtubePlayer.pauseVideo(); } if (data.action === "seek") youtubePlayer.seekTo(data.time || 0, true); setTimeout(() => { applyingRemoteState = false; }, 250); };

const logout = () => { roomChannel?.close(); roomChannel = null; state.user = null; state.accessToken = ""; state.recommendations = []; state.channels = []; state.roomCode = ""; state.role = ""; state.partner = null; state.decisions = { host: {}, guest: {} }; state.matches = []; localStorage.removeItem(STORAGE_KEY); history.replaceState(null, "", window.location.pathname); showWelcome(); setFeedback(""); toast("Compte déconnecté."); };

$("#welcomeLogin").addEventListener("click", connectGoogle);
$("#headerLogin").addEventListener("click", connectGoogle);
$("#logoutButton").addEventListener("click", logout);
$("#accountContinue").addEventListener("click", () => setActiveStep("room"));
$("#createRoom").addEventListener("click", createRoom);
$("#joinRoom").addEventListener("click", joinRoom);
$("#joinCode").addEventListener("keydown", (event) => { if (event.key === "Enter") joinRoom(); });
$("#copyInvite").addEventListener("click", copyInvite);
$("#roomNext").addEventListener("click", () => { if (!state.roomCode) return toast("Crée un code avant de commencer."); setActiveStep("swipe"); });
$("#backToRoom").addEventListener("click", () => setActiveStep("room"));
$("#backToSwipe").addEventListener("click", () => setActiveStep("swipe"));
$("#passButton").addEventListener("click", () => finishDecision("pass"));
$("#likeButton").addEventListener("click", () => finishDecision("like"));
$("#sideMatchButton").addEventListener("click", () => state.matches[0] && openWatch(state.matches[0]));
$("#loadWatchButton").addEventListener("click", () => loadWatchVideo(getVideoIdFromUrl($("#watchUrl").value)));
$("#watchUrl").addEventListener("keydown", (event) => { if (event.key === "Enter") loadWatchVideo(getVideoIdFromUrl(event.currentTarget.value)); });
$("#watchPlayButton").addEventListener("click", () => { if (!youtubeReady) return toast("Le lecteur YouTube se prépare encore."); youtubePlayer.getPlayerState() === YT.PlayerState.PLAYING ? youtubePlayer.pauseVideo() : youtubePlayer.playVideo(); });
$("#watchTimeline").addEventListener("input", (event) => { if (youtubeReady) $("#watchTime").textContent = `${formatTime(Number(event.currentTarget.value) / 100 * youtubePlayer.getDuration())} / ${formatTime(youtubePlayer.getDuration())}`; });
$("#watchTimeline").addEventListener("change", (event) => { if (!youtubeReady) return; const time = Number(event.currentTarget.value) / 100 * youtubePlayer.getDuration(); youtubePlayer.seekTo(time, true); send("watch", { action: "seek", time }); });
$("#watchMuteButton").addEventListener("click", () => { if (!youtubeReady) return; muted = !muted; muted ? youtubePlayer.mute() : youtubePlayer.unMute(); $("#watchMuteButton").textContent = muted ? "◌" : "◖"; });
$$(".flow-step").forEach((button) => button.addEventListener("click", () => setActiveStep(button.dataset.step)));

setInterval(updateWatchTime, 500);
renderRoom();
if (state.roomCode) $("#joinCode").value = state.roomCode;
