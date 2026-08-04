/*
 * WatchParty — taste matching + swipe room
 *
 * Google auth is wired for Google Identity Services. Add a local config.js
 * with a Google OAuth client ID to enable it (see config.example.js).
 * The YouTube / swipe state uses BroadcastChannel for a local two-tab demo;
 * a production room should replace it with a server-side realtime channel.
 */

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const config = window.WATCHPARTY_CONFIG || {};
const GOOGLE_CLIENT_ID = config.googleClientId || "";
const YOUTUBE_API_KEY = config.youtubeApiKey || "";
const roomId = "watchparty-demo-room";
const roomChannel = "BroadcastChannel" in window ? new BroadcastChannel(`watchparty:${roomId}`) : null;

const catalog = [
  { id: "city", title: "An Evening in the City", type: "Short film", meta: "04:32 · atmosphère", youtubeId: "M7lc1UVf-VE", classes: "card-blue", tags: ["ville", "nuit"], description: "Une petite dérive urbaine, des fenêtres allumées et une bande-son qui fait marcher plus lentement." },
  { id: "koyaanisqatsi", title: "Koyaanisqatsi", type: "Documentaire", meta: "01:26:00 · regard", youtubeId: "v6-K-arVl-U", classes: "card-violet", tags: ["rythme", "monde"], description: "Un film sans dialogue où le monde devient une partition de mouvements, de lumières et de vitesse." },
  { id: "paper", title: "Paper Planes", type: "Animation", meta: "07:15 · tendre", youtubeId: "aqz-KE-bpKQ", classes: "card-lime", tags: ["animation", "léger"], description: "Des dessins, du vent et une idée qui prend forme juste au moment où on cesse de la chercher." },
  { id: "nightwalk", title: "Night Walk", type: "Video essay", meta: "12:08 · curiosité", youtubeId: "dQw4w9WgXcQ", classes: "card-orange", tags: ["ville", "étrange"], description: "Pourquoi les villes changent de visage quand les vitrines s’éteignent." },
  { id: "deep", title: "The Deep Field", type: "Science", meta: "08:40 · vertige", youtubeId: "GoW8Tf7hTGA", classes: "card-blue", tags: ["science", "silence"], description: "Un voyage dans ce qu’on ne peut pas voir depuis la fenêtre, mais qui est pourtant juste là." },
  { id: "comedy", title: "A Very Serious Film", type: "Humour sec", meta: "05:21 · absurde", youtubeId: "ScMzIvxBSi4", classes: "card-orange", tags: ["humour", "bizarre"], description: "Une enquête méthodique sur un problème qui n’existe probablement pas." },
  { id: "waves", title: "Waves / 1999", type: "Live session", meta: "09:03 · musique", youtubeId: "hT_nvWreIhg", classes: "card-violet", tags: ["musique", "analogique"], description: "Une session live granuleuse, exactement à la frontière entre concert et film de vacances." },
];

const recommendationCatalog = [
  { title: "The Deep Field", kicker: "POUR VOUS DEUX", meta: "science · 92%", art: "art-blue", videoId: "deep" },
  { title: "Paper Planes", kicker: "LÉA → VOUS", meta: "animation · 88%", art: "art-coral", videoId: "paper" },
  { title: "Night Walk", kicker: "VOUS → LÉA", meta: "curiosité · 81%", art: "art-violet", videoId: "nightwalk" },
];

const defaultProfiles = {
  me: { name: "Moi", email: "Connectez Google pour analyser vos goûts.", avatar: "M", avatarClass: "avatar-moncef", authenticated: false, interests: { cinema: 82, doc: 64, animation: 48, weird: 71 } },
  lea: { name: "Léa", email: "Connectez Google pour analyser ses goûts.", avatar: "L", avatarClass: "avatar-lea", authenticated: false, interests: { cinema: 74, doc: 81, animation: 62, weird: 69 } },
};
const blankState = { profiles: defaultProfiles, decisions: { me: {}, lea: {} }, matches: [] };
let savedState = {};
try { savedState = JSON.parse(localStorage.getItem("watchparty-state") || "{}"); } catch (_) { savedState = {}; }
const state = {
  profiles: { me: { ...defaultProfiles.me, ...(savedState.profiles?.me || {}) }, lea: { ...defaultProfiles.lea, ...(savedState.profiles?.lea || {}) } },
  decisions: { me: { ...(savedState.decisions?.me || {}) }, lea: { ...(savedState.decisions?.lea || {}) } },
  matches: [...(savedState.matches || [])],
};
let activeProfile = "me";
let selectedCardId = null;
let authTarget = "me";
let toastTimer;
let googleTokenClient;
let youtubePlayer;
let youtubeReady = false;
let applyingRemoteState = false;
let muted = false;

const persistState = () => localStorage.setItem("watchparty-state", JSON.stringify(state));
const send = (type, payload = {}) => roomChannel?.postMessage({ type, ...payload, sentAt: Date.now() });
const toast = (message) => {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("visible"), 2900);
};
const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return "00:00";
  const minutes = Math.floor(seconds / 60);
  return `${String(Math.floor(minutes)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
};
const getVideoIdFromUrl = (value) => {
  try {
    const url = new URL(value);
    if (url.hostname.includes("youtu.be")) return url.pathname.slice(1).split("/")[0];
    if (url.hostname.includes("youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      if (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2];
    }
  } catch (_) { return null; }
  return null;
};

const setProfile = (profileId) => {
  activeProfile = profileId;
  $$("[data-profile]").forEach((button) => button.classList.toggle("is-active", button.dataset.profile === profileId));
  renderProfile();
  renderSwipeDeck();
};

const renderProfile = () => {
  const profile = state.profiles[activeProfile];
  $("#profileAvatar").textContent = profile.avatar;
  $("#profileAvatar").className = `profile-avatar-large ${profile.avatarClass}`;
  $("#profileName").textContent = profile.name;
  $("#profileEmail").textContent = profile.email;
  $("#profileState").textContent = profile.authenticated ? "GOOGLE CONNECTÉ" : "APERÇU DE PROFIL";
  $("#profileLoginLabel").textContent = profile.authenticated ? "Profil Google connecté" : "Connecter ce profil avec Google";
  Object.entries(profile.interests).forEach(([key, value]) => {
    const valueNode = $(`[data-interest-value="${key}"]`);
    const barNode = $(`[data-interest-bar="${key}"]`);
    if (valueNode) valueNode.textContent = `${value}%`;
    if (barNode) barNode.style.width = `${value}%`;
  });
  const navProfile = state.profiles.me.authenticated ? state.profiles.me.name : "Mode aperçu";
  $("#navAccountLabel").textContent = navProfile;
  $("#swipeStatus").textContent = `Swipez en tant que ${profile.name}`;
};

const renderRecommendations = () => {
  const profile = state.profiles[activeProfile];
  const partner = state.profiles[activeProfile === "me" ? "lea" : "me"];
  const grid = $("#recommendationGrid");
  grid.innerHTML = recommendationCatalog.map((item, index) => {
    const boost = profile.authenticated || partner.authenticated ? (index === 0 ? "94%" : index === 1 ? "89%" : "84%") : item.meta.split("·")[1].trim();
    return `<button class="recommendation-item" data-recommendation="${item.videoId}" type="button"><span class="recommendation-art ${item.art}"></span><span class="recommendation-copy"><span class="profile-micro">${item.kicker}</span><strong>${item.title}</strong><span>${boost} · voir la carte</span></span></button>`;
  }).join("");
  $$("[data-recommendation]").forEach((button) => button.addEventListener("click", () => {
    const video = catalog.find((item) => item.id === button.dataset.recommendation);
    if (video) openInfo(video);
  }));
};

const renderMatches = () => {
  const list = $("#matchList");
  $("#matchCount").textContent = String(state.matches.length);
  if (!state.matches.length) {
    list.innerHTML = `<div class="empty-match"><span>◎</span><p>Les cartes que vous aimez tous les deux apparaîtront ici.</p></div>`;
    return;
  }
  list.innerHTML = state.matches.slice(0, 4).map((id) => {
    const video = catalog.find((item) => item.id === id);
    return `<button class="match-item" data-match="${video.id}" type="button"><span class="match-item-art ${video.classes}"></span><span class="match-item-copy"><strong>${video.title}</strong><span>${video.type} · match trouvé</span></span><span class="match-item-arrow">↗</span></button>`;
  }).join("");
  $$("[data-match]").forEach((button) => button.addEventListener("click", () => openMatch(catalog.find((item) => item.id === button.dataset.match))));
};

const queueFor = (profileId) => catalog.filter((video) => !state.decisions[profileId][video.id]);
const renderCardContent = (video) => {
  if (!video) return `<div class="empty-match" style="height:100%;border:0;background:transparent;color:#657487"><span>✓</span><p>Cette pile est vide.<br />Changez de profil ou revenez plus tard.</p></div>`;
  return `<div class="card-art-scene"><span class="scene-line"></span><span class="scene-window"></span></div><div class="card-topline"><span>WATCHPARTY / ${video.id.toUpperCase()}</span><span>⟲ ${video.meta.split("·")[0].trim()}</span></div><div class="card-bottomline"><div><small>${video.type}</small><strong>${video.title.split(" ").slice(0, 2).join(" ")}<br /><em>${video.title.split(" ").slice(2).join(" ") || "tonight"}</em></strong><div class="card-tags">${video.tags.map((tag) => `<span>${tag}</span>`).join("")}</div></div><span>↗</span></div>`;
};
const renderSwipeDeck = () => {
  const queue = queueFor(activeProfile);
  const current = queue[0];
  const next = queue[1];
  selectedCardId = current?.id || null;
  const card = $("#activeSwipeCard");
  card.className = `swipe-card swipe-card-active ${current?.classes || "card-blue"}`;
  card.innerHTML = renderCardContent(current);
  card.style.animation = "cardEnter .34s ease both";
  card.tabIndex = current ? 0 : -1;
  const underCards = $$(".swipe-card-under");
  underCards[0].style.transform = next ? "translate(14px, 14px) rotate(6deg)" : "translate(0) rotate(0)";
  underCards[1].style.transform = queue[2] ? "translate(7px, 7px) rotate(3deg)" : "translate(0) rotate(0)";
  $("#swipeCount").textContent = `${current ? catalog.length - queue.length + 1 : catalog.length} / ${catalog.length}`;
  $("#passButton").disabled = !current;
  $("#likeButton").disabled = !current;
  $("#infoButton").disabled = !current;
  bindCardGesture();
};

const commitDecision = (decision) => {
  const videoId = selectedCardId;
  if (!videoId) return toast("Cette pile est déjà passée par là.");
  const video = catalog.find((item) => item.id === videoId);
  const card = $("#activeSwipeCard");
  const stamp = decision === "like" ? $("#stampYes") : $("#stampNo");
  stamp.style.opacity = "1";
  card.style.animation = `${decision === "like" ? "cardExitRight" : "cardExitLeft"} .42s cubic-bezier(.2,.8,.2,1) both`;
  state.decisions[activeProfile][videoId] = decision;
  persistState();
  send("decision", { profileId: activeProfile, videoId, decision });
  setTimeout(() => {
    stamp.style.opacity = "0";
    renderSwipeDeck();
    renderMatches();
  }, 410);
  if (decision === "like" && state.decisions[activeProfile === "me" ? "lea" : "me"][videoId] === "like") {
    if (!state.matches.includes(videoId)) state.matches.unshift(videoId);
    persistState();
    renderMatches();
    showMatch(video);
  } else {
    toast(decision === "like" ? `${video.title} gardé dans votre pile.` : `${video.title} passé — suivant.`);
  }
};

const bindCardGesture = () => {
  const card = $("#activeSwipeCard");
  if (!selectedCardId) return;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let moved = false;
  const clear = () => { card.style.transform = ""; card.style.transition = "transform .25s ease"; };
  card.addEventListener("pointerdown", (event) => { dragging = true; moved = false; startX = event.clientX; startY = event.clientY; card.setPointerCapture?.(event.pointerId); card.style.transition = "none"; });
  card.addEventListener("pointermove", (event) => { if (!dragging) return; const dx = event.clientX - startX; const dy = event.clientY - startY; if (Math.abs(dx) > 8) moved = true; card.style.transform = `translate(${dx}px, ${dy * .25}px) rotate(${dx / 13}deg)`; $("#stampYes").style.opacity = Math.min(1, Math.max(0, dx / 125)); $("#stampNo").style.opacity = Math.min(1, Math.max(0, -dx / 125)); });
  card.addEventListener("pointerup", (event) => { if (!dragging) return; dragging = false; const dx = event.clientX - startX; $("#stampYes").style.opacity = "0"; $("#stampNo").style.opacity = "0"; if (Math.abs(dx) > 90) commitDecision(dx > 0 ? "like" : "pass"); else if (moved) clear(); });
  card.addEventListener("pointercancel", () => { dragging = false; clear(); $("#stampYes").style.opacity = "0"; $("#stampNo").style.opacity = "0"; });
};

const showMatch = (video) => {
  toast(`Match trouvé : ${video.title} ✦`);
  const preview = $("#watchMatchPreview");
  preview.innerHTML = `<div class="preview-poster ${video.classes}"><span>${video.title.split(" ").slice(0, 2).join("<br />")}<br /><em>${video.title.split(" ").slice(2).join(" ")}</em></span></div><div><span class="profile-micro">MATCH À ${Math.round(78 + Math.random() * 18)}%</span><h3>${video.title}</h3><p>${video.type} · prêt à lancer dans le Watchroom.</p><button class="button button-outline" data-open-match="true" type="button">Lancer la vidéo <span>→</span></button></div>`;
  $("[data-open-match]").addEventListener("click", () => openMatch(video));
};

const openMatch = (video) => { if (!video) return; $("#watchUrl").value = `https://youtu.be/${video.youtubeId}`; loadWatchVideo(video.youtubeId); $("#watch").scrollIntoView({ behavior: "smooth" }); };

const openInfo = (video) => {
  $("#infoModalContent").innerHTML = `<span class="profile-micro">${video.type} · ${video.meta}</span><h2 id="infoTitle">${video.title}</h2><p class="info-copy">${video.description}</p><div class="common-tags card-info-tags">${video.tags.map((tag) => `<span class="tag tag-plain">${tag}</span>`).join("")}</div><button class="button button-lime" data-info-like="true" type="button">Garder cette carte <span>↗</span></button>`;
  $("#infoModal").hidden = false;
  $("[data-info-like]").addEventListener("click", () => { $("#infoModal").hidden = true; if (!state.decisions[activeProfile][video.id]) { selectedCardId = video.id; commitDecision("like"); } });
};

/* Google Identity Services */
const showAuth = (profileId = activeProfile) => {
  authTarget = profileId;
  const profile = state.profiles[profileId];
  $("#authTargetName").textContent = profile.name;
  $("#authTargetAvatar").textContent = profile.avatar;
  $("#authTargetAvatar").className = `avatar ${profile.avatarClass}`;
  $("#authFeedback").textContent = GOOGLE_CLIENT_ID ? "La fenêtre Google demandera l’accès à vos informations YouTube." : "Ajoutez votre Client ID Google dans config.js pour activer la connexion réelle. Le mode aperçu reste disponible ci-dessous.";
  $("#authModal").hidden = false;
  $("#modalGoogleButton").focus();
};

const loadGoogleProfile = async (accessToken, profileId) => {
  const userResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!userResponse.ok) throw new Error("Impossible de récupérer le profil Google.");
  const user = await userResponse.json();
  const profile = state.profiles[profileId];
  profile.authenticated = true;
  profile.name = user.given_name || user.name || profile.name;
  profile.email = user.email || "Compte Google connecté";
  if (user.picture) profile.picture = user.picture;
  try {
    const [subscriptions, likes] = await Promise.all([fetchYouTube("subscriptions", { part: "snippet", mine: "true", maxResults: "50" }, accessToken), fetchYouTube("videos", { part: "snippet", myRating: "like", maxResults: "50" }, accessToken)]);
    const signals = [...(subscriptions.items || []).flatMap((item) => [item.snippet?.title, item.snippet?.description]), ...(likes.items || []).flatMap((item) => [item.snippet?.title, item.snippet?.description])].filter(Boolean).join(" ").toLowerCase();
    profile.interests = interestsFromSignals(signals, profile.interests);
  } catch (_) {
    $("#authFeedback").textContent = "Profil Google connecté. L’analyse YouTube sera complète dès que l’API YouTube sera activée dans votre projet.";
  }
  persistState();
  renderProfile();
  renderRecommendations();
  $("#authModal").hidden = true;
  toast(`${profile.name} est connecté·e à WatchParty.`);
};

const fetchYouTube = async (resource, params, accessToken) => {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  if (YOUTUBE_API_KEY) url.searchParams.set("key", YOUTUBE_API_KEY);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("YouTube API indisponible");
  return response.json();
};

const interestsFromSignals = (signals, fallback) => {
  const score = { cinema: 50, doc: 50, animation: 50, weird: 50 };
  const add = (key, terms) => { const hits = terms.reduce((count, term) => count + (signals.split(term).length - 1), 0); score[key] = Math.min(96, fallback[key] + hits * 5); };
  add("cinema", ["film", "cinema", "director", "movie", "acteur"]); add("doc", ["documentaire", "science", "history", "nature", "histoire"]); add("animation", ["animation", "animated", "illustration", "anime"]); add("weird", ["comedy", "humour", "strange", "absurd", "bizarre"]);
  return score;
};

const connectGoogle = () => {
  if (!GOOGLE_CLIENT_ID) { $("#authFeedback").textContent = "Connexion réelle non activée : ajoutez googleClientId dans config.js, puis rechargez la page."; return; }
  if (!window.google?.accounts?.oauth2) { $("#authFeedback").textContent = "Google est encore en train de se charger. Réessayez dans un instant."; return; }
  googleTokenClient = window.google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: "openid profile email https://www.googleapis.com/auth/youtube.readonly", callback: async (response) => { if (response.error) { $("#authFeedback").textContent = "La connexion Google a été annulée."; return; } try { $("#authFeedback").textContent = "Analyse de vos goûts YouTube…"; await loadGoogleProfile(response.access_token, authTarget); } catch (error) { $("#authFeedback").textContent = error.message; } } });
  googleTokenClient.requestAccessToken({ prompt: "select_account" });
};

const demoLogin = () => {
  const profile = state.profiles[authTarget];
  profile.authenticated = true;
  profile.email = authTarget === "me" ? "moncef.demo@watchparty.local" : "lea.demo@watchparty.local";
  persistState();
  renderProfile();
  renderRecommendations();
  $("#authModal").hidden = true;
  toast(`${profile.name} rejoint le mode aperçu.`);
};

/* YouTube IFrame Player */
window.onYouTubeIframeAPIReady = () => {
  youtubePlayer = new YT.Player("youtubePlayer", { videoId: "", playerVars: { modestbranding: 1, rel: 0, playsinline: 1, controls: 0 }, events: { onReady: () => { youtubeReady = true; updateWatchTime(); }, onStateChange: (event) => { if (!applyingRemoteState) { if (event.data === YT.PlayerState.PLAYING) send("watch", { action: "play", time: youtubePlayer.getCurrentTime() }); if (event.data === YT.PlayerState.PAUSED) send("watch", { action: "pause", time: youtubePlayer.getCurrentTime() }); } $("#watchPlayButton").textContent = event.data === YT.PlayerState.PLAYING ? "Ⅱ" : "▶"; } } });
};
const loadWatchVideo = (videoId, announce = true) => { if (!videoId) return toast("Ce lien ne ressemble pas à une vidéo YouTube."); if (!youtubeReady) return toast("Le lecteur YouTube se prépare encore."); youtubePlayer.loadVideoById(videoId); $("#watchSyncLabel").textContent = "● lecteur prêt"; if (announce) send("watch", { action: "load", videoId }); };
const updateWatchTime = () => { if (!youtubeReady || !youtubePlayer?.getDuration) return; const current = youtubePlayer.getCurrentTime() || 0; const duration = youtubePlayer.getDuration() || 0; $("#watchTimeline").value = duration ? current / duration * 100 : 0; $("#watchTime").textContent = `${formatTime(current)} / ${formatTime(duration)}`; };

/* Events */
$$("[data-profile]").forEach((button) => button.addEventListener("click", () => setProfile(button.dataset.profile)));
$$(`[data-login-button="true"]`).forEach((button) => button.addEventListener("click", () => showAuth(activeProfile)));
$("#navGoogleButton").addEventListener("click", () => showAuth("me"));
$("#heroGoogleButton").addEventListener("click", () => showAuth("me"));
$("#closingLoginButton").addEventListener("click", () => showAuth("me"));
$("#modalGoogleButton").addEventListener("click", connectGoogle);
$("#demoLoginButton").addEventListener("click", demoLogin);
$("#closeAuthModal").addEventListener("click", () => { $("#authModal").hidden = true; });
$("#closeInfoModal").addEventListener("click", () => { $("#infoModal").hidden = true; });
$("#authModal").addEventListener("click", (event) => { if (event.target === $("#authModal")) $("#authModal").hidden = true; });
$("#infoModal").addEventListener("click", (event) => { if (event.target === $("#infoModal")) $("#infoModal").hidden = true; });
$("#passButton").addEventListener("click", () => commitDecision("pass"));
$("#likeButton").addEventListener("click", () => commitDecision("like"));
$("#infoButton").addEventListener("click", () => { const video = catalog.find((item) => item.id === selectedCardId); if (video) openInfo(video); });
$("#refreshRecommendations").addEventListener("click", () => { renderRecommendations(); toast("Nouveau mix composé à partir de vos signaux."); });
$("#loadWatchButton").addEventListener("click", () => loadWatchVideo(getVideoIdFromUrl($("#watchUrl").value)));
$("#watchUrl").addEventListener("keydown", (event) => { if (event.key === "Enter") loadWatchVideo(getVideoIdFromUrl(event.currentTarget.value)); });
$("#watchPlayButton").addEventListener("click", () => { if (!youtubeReady) return toast("Le lecteur YouTube se prépare encore."); if (youtubePlayer.getPlayerState() === YT.PlayerState.PLAYING) youtubePlayer.pauseVideo(); else youtubePlayer.playVideo(); });
$("#watchTimeline").addEventListener("input", (event) => { if (youtubeReady) $("#watchTime").textContent = `${formatTime(Number(event.currentTarget.value) / 100 * youtubePlayer.getDuration())} / ${formatTime(youtubePlayer.getDuration())}`; });
$("#watchTimeline").addEventListener("change", (event) => { if (!youtubeReady) return; const time = Number(event.currentTarget.value) / 100 * youtubePlayer.getDuration(); youtubePlayer.seekTo(time, true); send("watch", { action: "seek", time }); });
$("#watchMuteButton").addEventListener("click", () => { if (!youtubeReady) return; muted = !muted; muted ? youtubePlayer.mute() : youtubePlayer.unMute(); $("#watchMuteButton").textContent = muted ? "◌" : "◖"; });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { $("#authModal").hidden = true; $("#infoModal").hidden = true; } if (event.target.tagName !== "INPUT" && event.key === "ArrowLeft") commitDecision("pass"); if (event.target.tagName !== "INPUT" && event.key === "ArrowRight") commitDecision("like"); });

roomChannel?.addEventListener("message", ({ data }) => {
  if (!data || data.sentAt > Date.now() + 1000) return;
  if (data.type === "decision") { state.decisions[data.profileId][data.videoId] = data.decision; const other = data.profileId === "me" ? "lea" : "me"; if (data.decision === "like" && state.decisions[other][data.videoId] === "like" && !state.matches.includes(data.videoId)) { state.matches.unshift(data.videoId); showMatch(catalog.find((item) => item.id === data.videoId)); } persistState(); renderMatches(); renderSwipeDeck(); }
  if (data.type !== "watch" || !youtubeReady) return;
  applyingRemoteState = true;
  if (data.action === "load") youtubePlayer.loadVideoById(data.videoId);
  if (data.action === "play") { youtubePlayer.seekTo(data.time || 0, true); youtubePlayer.playVideo(); }
  if (data.action === "pause") { youtubePlayer.seekTo(data.time || 0, true); youtubePlayer.pauseVideo(); }
  if (data.action === "seek") youtubePlayer.seekTo(data.time || 0, true);
  setTimeout(() => { applyingRemoteState = false; }, 250);
});

setInterval(() => { updateWatchTime(); }, 500);
renderProfile();
renderRecommendations();
renderMatches();
renderSwipeDeck();
