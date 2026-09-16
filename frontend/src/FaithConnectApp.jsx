/**
 * FaithConnect — all-in-one app file.
 *
 * Contains: API client, AuthContext, ProtectedRoute, LandingPage, LoginPage,
 * RegisterPage, PostCard, CreatePostForm, FeedPage, ChurchTimelinePage, and
 * the router. Import <App /> from your main.jsx and render it — that's the
 * only other file you need.
 *
 * npm install react-router-dom
 * Tailwind must already be set up (src/index.css with @tailwind directives).
 *
 * FONT: the landing/login/register pages use "Fraunces" for headlines.
 * Add this to your index.html <head> (or import it in src/index.css):
 *   <link rel="preconnect" href="https://fonts.googleapis.com">
 *   <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&display=swap" rel="stylesheet">
 * Without it, the browser falls back to the generic serif in the stack.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

// =====================================================================
// 1. API CLIENT
// =====================================================================

// Points at your own self-hosted backend (see ../backend/server.js).
// Once that backend is deployed somewhere public, swap this for its real
// URL (e.g. "https://your-backend.up.railway.app").
const BASE_URL = "https://faithconnect-backend-2pml.onrender.com";
const TOKEN_KEY = "faithconnect_token";

/**
 * "urlencoded" matches the openapi.json spec for /auth/login
 * (Body_login_auth_login_post is application/x-www-form-urlencoded).
 * Flip to "multipart" only if your backend truly wants a FormData body —
 * a real FormData object makes the browser send multipart/form-data,
 * which most FastAPI OAuth2 login endpoints will reject with a 422.
 */
const LOGIN_BODY_MODE = "urlencoded";

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

class FaithConnectApi {
  constructor(baseUrl = BASE_URL) {
    this.baseUrl = baseUrl;
    /** Called on any 401 — AuthContext hooks into this to drop the session. */
    this.onUnauthorized = null;
  }

  getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* localStorage unavailable — ignore */
    }
  }

  isAuthenticated() {
    return Boolean(this.getToken());
  }

  logout() {
    this.setToken(null);
  }

  async request(path, options = {}) {
    const {
      method = "GET",
      body,
      isForm = false,
      isMultipart = false,
      headers = {},
      auth = true,
    } = options;

    const finalHeaders = { ...headers };
    let finalBody = body;

    if (body !== undefined && body !== null) {
      if (isMultipart) {
        finalBody = body; // FormData sets its own boundary
      } else if (isForm) {
        finalHeaders["Content-Type"] = "application/x-www-form-urlencoded";
        finalBody =
          body instanceof URLSearchParams
            ? body.toString()
            : new URLSearchParams(body).toString();
      } else {
        finalHeaders["Content-Type"] = "application/json";
        finalBody = JSON.stringify(body);
      }
    }

    if (auth) {
      const token = this.getToken();
      if (token) finalHeaders["Authorization"] = `Bearer ${token}`;
    }

    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: finalHeaders,
        body: finalBody,
      });
    } catch (networkErr) {
      throw new ApiError(
        `Network error calling ${method} ${path}: ${networkErr.message}`,
        0,
        null
      );
    }

    if (response.status === 204) return null;

    const contentType = response.headers.get("content-type") || "";
    const parsed = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => null);

    if (!response.ok) {
      const message =
        (parsed && typeof parsed === "object" && (parsed.detail || parsed.message)) ||
        `Request failed: ${method} ${path} (${response.status})`;
      const err = new ApiError(
        typeof message === "string" ? message : JSON.stringify(message),
        response.status,
        parsed
      );

      if (response.status === 401) {
        this.setToken(null);
        if (this.onUnauthorized) this.onUnauthorized();
      }

      throw err;
    }

    return parsed;
  }
}

const apiClient = new FaithConnectApi();

async function apiRegister(userData) {
  const token = await apiClient.request("/auth/register", {
    method: "POST",
    body: userData,
    auth: false,
  });
  if (token?.access_token) apiClient.setToken(token.access_token);
  return token;
}

async function apiLogin(username, password) {
  const token = await apiClient.request("/auth/login", {
    method: "POST",
    isForm: LOGIN_BODY_MODE === "urlencoded",
    isMultipart: LOGIN_BODY_MODE === "multipart",
    body:
      LOGIN_BODY_MODE === "multipart"
        ? (() => {
            const fd = new FormData();
            fd.append("username", username);
            fd.append("password", password);
            return fd;
          })()
        : { username, password },
    auth: false,
  });
  if (token?.access_token) apiClient.setToken(token.access_token);
  return token;
}

function apiLogout() {
  apiClient.logout();
}

function apiMe() {
  return apiClient.request("/auth/me");
}

function apiGetPublicFeed(params = {}) {
  const q = new URLSearchParams();
  if (params.limit !== undefined) q.set("limit", params.limit);
  if (params.offset !== undefined) q.set("offset", params.offset);
  const query = q.toString() ? `?${q.toString()}` : "";
  return apiClient.request(`/feed${query}`);
}

// Church timeline shows ALL of that church's posts regardless of the
// post's own visibility flag (unlike the public /feed).
function apiGetChurchTimeline(churchId, params = {}) {
  const q = new URLSearchParams();
  if (params.limit !== undefined) q.set("limit", params.limit);
  if (params.offset !== undefined) q.set("offset", params.offset);
  const query = q.toString() ? `?${q.toString()}` : "";
  return apiClient.request(`/churches/${churchId}/timeline${query}`);
}

function apiGetChurch(churchId) {
  return apiClient.request(`/churches/${churchId}`);
}

/** @param {{brandId?: string}} [params] */
function apiGetChurches(params = {}) {
  const query = params.brandId ? `?brand_id=${encodeURIComponent(params.brandId)}` : "";
  return apiClient.request(`/churches${query}`);
}

function apiGetBrands() {
  return apiClient.request("/brands");
}

/** @param {{name: string, slug: string, description?: string, logo_media_id?: string}} brandData */
function apiCreateBrand(brandData) {
  return apiClient.request("/brands", { method: "POST", body: brandData });
}

/**
 * @param {{brand_id: string, name: string, slug: string, description?: string,
 *   location_text?: string, latitude?: number, longitude?: number, cover_media_id?: string}} churchData
 * brand_id and slug are REQUIRED by the real ChurchCreate schema — this
 * isn't optional metadata, the request 422s without them.
 */
function apiCreateChurch(churchData) {
  return apiClient.request("/churches", { method: "POST", body: churchData });
}

/**
 * Admin trust stamp — per the spec, a church's own owner-tagged members
 * are NOT given this by default, only platform admins. Expect a 403 for
 * most users; the UI below surfaces that rather than hiding the button.
 */
function apiVerifyChurch(churchId) {
  return apiClient.request(`/churches/${churchId}/verify`, { method: "PATCH" });
}

function apiListMembers(churchId) {
  return apiClient.request(`/churches/${churchId}/members`);
}

/** Covers both self-join and an admin adding another user by id. */
function apiAddMember(churchId, memberData) {
  return apiClient.request(`/churches/${churchId}/members`, {
    method: "POST",
    body: memberData,
  });
}

function apiRemoveMember(churchId, userId) {
  return apiClient.request(`/churches/${churchId}/members/${userId}`, {
    method: "DELETE",
  });
}

function apiListTags(churchId) {
  return apiClient.request(`/churches/${churchId}/tags`);
}

/** @param {{name: string}} tagData */
function apiCreateTag(churchId, tagData) {
  return apiClient.request(`/churches/${churchId}/tags`, {
    method: "POST",
    body: tagData,
  });
}

function apiAssignTag(churchId, userId, tagAssignment) {
  return apiClient.request(`/churches/${churchId}/members/${userId}/tags`, {
    method: "POST",
    body: tagAssignment,
  });
}

function apiRevokeTag(churchId, userId, tagId) {
  return apiClient.request(`/churches/${churchId}/members/${userId}/tags/${tagId}`, {
    method: "DELETE",
  });
}

/** Open self-join path — no admin approval needed for a public church. */
function apiJoinChurch(churchId) {
  return apiClient.request(`/churches/${churchId}/join`, { method: "POST" });
}

/** @param {string} churchId @param {{body?: string, media_id?: string}} data */
function apiSendGcMessage(churchId, data) {
  return apiClient.request(`/churches/${churchId}/gc/messages`, {
    method: "POST",
    body: data,
  });
}

/** @param {string} churchId @param {{limit?: number, before?: string}} [params] */
function apiListGcMessages(churchId, params = {}) {
  const q = new URLSearchParams();
  if (params.limit !== undefined) q.set("limit", params.limit);
  if (params.before) q.set("before", params.before);
  const query = q.toString() ? `?${q.toString()}` : "";
  return apiClient.request(`/churches/${churchId}/gc/messages${query}`);
}

/** @param {string} churchId @param {string} messageId */
function apiDeleteGcMessage(churchId, messageId) {
  return apiClient.request(`/churches/${churchId}/gc/messages/${messageId}`, {
    method: "DELETE",
  });
}

function apiGetUserChurchHistory(userId) {
  return apiClient.request(`/users/${userId}/churches`);
}

/**
 * Generic upload — returns a MediaOut whose `id` can then be attached to a
 * post, story, event, avatar, etc. Used here for optional story images.
 * @param {File} file
 */
function apiUploadMedia(file) {
  const formData = new FormData();
  formData.append("file", file);
  return apiClient.request("/uploads", {
    method: "POST",
    isMultipart: true,
    body: formData,
  });
}

/**
 * @param {string} churchId
 * @param {{media_id: string, caption?: string}} data
 * media_id is REQUIRED by the real StoryCreate schema — the API doesn't
 * support text-only stories.
 */
function apiCreateStory(churchId, data) {
  return apiClient.request(`/churches/${churchId}/stories`, {
    method: "POST",
    body: data,
  });
}

// Members-only; the API auto-filters expired stories, so whatever comes
// back here is already "active."
function apiListActiveStories(churchId) {
  return apiClient.request(`/churches/${churchId}/stories`);
}

/** @param {string} churchId @param {{body?: string, visibility?: string, media_ids?: string[]}} data */
function apiCreatePost(churchId, data) {
  return apiClient.request(`/churches/${churchId}/posts`, {
    method: "POST",
    body: data,
  });
}

function apiLikePost(postId) {
  return apiClient.request(`/posts/${postId}/like`, { method: "POST" });
}

function apiUnlikePost(postId) {
  return apiClient.request(`/posts/${postId}/like`, { method: "DELETE" });
}

// PostOut has NO like_count/liked_by_me fields at all — likes live behind
// their own two endpoints and have to be fetched per post.
function apiGetLikeCount(postId) {
  return apiClient.request(`/posts/${postId}/likes/count`);
}

function apiHasLiked(postId) {
  return apiClient.request(`/posts/${postId}/likes/me`);
}

/**
 * @param {{body: string, church_id?: string, is_testimony?: boolean, is_anonymous?: boolean}} data
 */
function apiPostPrayerRequest(data) {
  return apiClient.request("/prayer-wall", { method: "POST", body: data });
}

/** @param {{church_id?: string, testimonies_only?: boolean, limit?: number, offset?: number}} [params] */
function apiListPrayerWall(params = {}) {
  const q = new URLSearchParams();
  if (params.church_id) q.set("church_id", params.church_id);
  if (params.testimonies_only) q.set("testimonies_only", "true");
  if (params.limit !== undefined) q.set("limit", params.limit);
  if (params.offset !== undefined) q.set("offset", params.offset);
  const query = q.toString() ? `?${q.toString()}` : "";
  return apiClient.request(`/prayer-wall${query}`);
}

/**
 * @param {string} requestId
 * @param {{type: string, comment_body?: string}} data
 * `type` has no documented enum in the spec — using "praying" as the value
 * for a plain "I'm praying for this" tap.
 */
function apiSupportPrayerRequest(requestId, data) {
  return apiClient.request(`/prayer-wall/${requestId}/support`, {
    method: "POST",
    body: data,
  });
}

/** @param {{title: string, source_topic?: string, body?: string, church_id?: string}} data */
function apiCreateThread(data) {
  return apiClient.request("/discussions", { method: "POST", body: data });
}

/** @param {{church_id?: string, limit?: number, offset?: number}} [params] */
function apiListThreads(params = {}) {
  const q = new URLSearchParams();
  if (params.church_id) q.set("church_id", params.church_id);
  if (params.limit !== undefined) q.set("limit", params.limit);
  if (params.offset !== undefined) q.set("offset", params.offset);
  const query = q.toString() ? `?${q.toString()}` : "";
  return apiClient.request(`/discussions${query}`);
}

/** @param {string} threadId @param {{body: string, parent_reply_id?: string}} data */
function apiReplyToThread(threadId, data) {
  return apiClient.request(`/discussions/${threadId}/replies`, {
    method: "POST",
    body: data,
  });
}

// No limit/offset params documented for this one — it's a flat list.
function apiListReplies(threadId) {
  return apiClient.request(`/discussions/${threadId}/replies`);
}

/**
 * @param {string} churchId
 * @param {{title: string, description?: string, event_type: string,
 *   start_time: string, end_time?: string, location_or_link?: string,
 *   cover_media_id?: string, speaker_ids?: string[]}} data
 * start_time/end_time are ISO datetime strings.
 */
function apiCreateEvent(churchId, data) {
  return apiClient.request(`/churches/${churchId}/events`, {
    method: "POST",
    body: data,
  });
}

// Public — no auth required, per the spec.
function apiListChurchEvents(churchId) {
  return apiClient.request(`/churches/${churchId}/events`, { auth: false });
}

/**
 * Global cross-church browse. Public — no auth required.
 * @param {{event_type?: string, upcoming_only?: boolean, limit?: number, offset?: number}} [params]
 */
function apiDiscoverEvents(params = {}) {
  const q = new URLSearchParams();
  if (params.event_type) q.set("event_type", params.event_type);
  if (params.upcoming_only !== undefined) q.set("upcoming_only", String(params.upcoming_only));
  if (params.limit !== undefined) q.set("limit", params.limit);
  if (params.offset !== undefined) q.set("offset", params.offset);
  const query = q.toString() ? `?${q.toString()}` : "";
  return apiClient.request(`/events/discover${query}`, { auth: false });
}

// Public — no auth required.
function apiGetEvent(eventId) {
  return apiClient.request(`/events/${eventId}`, { auth: false });
}

/**
 * @param {{name: string, bio?: string, church_id?: string, photo_media_id?: string,
 *   topics_csv?: string, contact_info?: string}} data
 */
function apiCreateSpeaker(data) {
  return apiClient.request("/speakers", { method: "POST", body: data });
}

/** @param {{topic?: string, church_id?: string}} [params] */
function apiSearchSpeakers(params = {}) {
  const q = new URLSearchParams();
  if (params.topic) q.set("topic", params.topic);
  if (params.church_id) q.set("church_id", params.church_id);
  const query = q.toString() ? `?${q.toString()}` : "";
  return apiClient.request(`/speakers${query}`);
}

// No documented admin-only restriction on this one (unlike church verify),
// but the 403 handler below is kept anyway in case the backend enforces
// one that isn't reflected in the spec's description — same surprise we
// hit with church creation.
function apiVerifySpeaker(speakerId) {
  return apiClient.request(`/speakers/${speakerId}/verify`, { method: "PATCH" });
}

/** @param {{name: string, description?: string, group_type: string, is_private?: boolean}} data */
function apiCreateGroup(data) {
  return apiClient.request("/groups", { method: "POST", body: data });
}

// Public — no auth in the spec's security config for this one.
/** @param {{group_type?: string}} [params] */
function apiListGroups(params = {}) {
  const query = params.group_type ? `?group_type=${encodeURIComponent(params.group_type)}` : "";
  return apiClient.request(`/groups${query}`, { auth: false });
}

function apiJoinGroup(groupId) {
  return apiClient.request(`/groups/${groupId}/join`, { method: "POST" });
}

/**
 * @param {string} churchId
 * @param {{title: string, description?: string, scheduled_start_time?: string, thumbnail_media_id?: string}} data
 */
function apiCreateLivestream(churchId, data) {
  return apiClient.request(`/churches/${churchId}/livestreams`, {
    method: "POST",
    body: data,
  });
}

// Public — no auth required, per the spec.
function apiListChurchLivestreams(churchId) {
  return apiClient.request(`/churches/${churchId}/livestreams`, { auth: false });
}

/**
 * Broadcaster-only — returns the secret RTMP URL + stream key. Never
 * shown to anyone except the person managing the stream.
 */
function apiGetLivestreamIngest(streamId) {
  return apiClient.request(`/livestreams/${streamId}/ingest`);
}

function apiGoLive(streamId) {
  return apiClient.request(`/livestreams/${streamId}/go-live`, { method: "POST" });
}

function apiEndLivestream(streamId) {
  return apiClient.request(`/livestreams/${streamId}/end`, { method: "POST" });
}

// Platform-wide, public — what's live right now, across every church.
function apiListLiveNow() {
  return apiClient.request("/livestreams/live", { auth: false });
}

/**
 * @param {{question: string, mode: string}} data
 * `mode` has no documented enum or default in the spec — it's just a
 * required string. The UI offers a few sensible guesses (general,
 * devotional, theology, counsel) plus a custom option; a 422 will reveal
 * the real accepted values if these guesses are wrong.
 */
function apiAskFaithAI(data) {
  return apiClient.request("/faithai/ask", { method: "POST", body: data });
}

/** @param {{limit?: number, offset?: number}} [params] */
function apiGetFaithAIHistory(params = {}) {
  const q = new URLSearchParams();
  if (params.limit !== undefined) q.set("limit", params.limit);
  if (params.offset !== undefined) q.set("offset", params.offset);
  const query = q.toString() ? `?${q.toString()}` : "";
  return apiClient.request(`/faithai/history${query}`);
}

// =====================================================================
// 1B. DISPLAY HELPERS
// =====================================================================
//
// IMPORTANT GAP IN THE API: there is no endpoint anywhere in the spec that
// returns another user's display name. UserOut (name/email/phone) only
// comes back from GET /auth/me — your OWN account. Posts (author_user_id),
// group chat messages (author_user_id), and memberships (user_id) all give
// you an id and nothing else. So anywhere this app shows "who posted this"
// for someone other than yourself, it can only show a short id, not a
// name — until the backend adds something like GET /users/{id}/profile.
function shortId(id, fallback = "Member") {
  if (!id) return fallback;
  return `${fallback} #${String(id).slice(-4)}`;
}

// =====================================================================
// 2. AUTH CONTEXT
// =====================================================================

const AuthContext = createContext(null);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on first load (page refresh keeps you logged in).
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      if (!apiClient.isAuthenticated()) {
        setLoading(false);
        return;
      }
      try {
        const currentUser = await apiMe();
        if (!cancelled) setUser(currentUser);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // Drop the session immediately if any request comes back 401.
  useEffect(() => {
    apiClient.onUnauthorized = () => setUser(null);
    return () => {
      apiClient.onUnauthorized = null;
    };
  }, []);

  const login = useCallback(async (username, password) => {
    await apiLogin(username, password);
    const currentUser = await apiMe();
    setUser(currentUser);
    return currentUser;
  }, []);

  // apiRegister already saves the token to localStorage on success — we
  // just need to fetch /auth/me afterward so the user is in context too,
  // same as login().
  const register = useCallback(async (userData) => {
    await apiRegister(userData);
    const currentUser = await apiMe();
    setUser(currentUser);
    return currentUser;
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setUser(null);
  }, []);

  const value = { user, loading, isAuthenticated: Boolean(user), login, register, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside an <AuthProvider>");
  return ctx;
}

// =====================================================================
// 3. PROTECTED ROUTE (+ bottom nav)
// =====================================================================

/** Simple stroke icon set for the bottom nav — same minimal style as FeatureGlyph. */
function NavIcon({ kind, className = "" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    home: <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z" {...common} />,
    search: <><circle cx="11" cy="11" r="6.5" {...common} /><path d="m20 20-4.3-4.3" {...common} /></>,
    prayer: <path d="M12 21c-4-2.5-7-6-7-10a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 4-3 7.5-7 10Z" {...common} />,
    chat: <path d="M4 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10l-5 4v-4H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" {...common} />,
    user: <><circle cx="12" cy="8" r="3.5" {...common} /><path d="M4.5 20c1.4-3.6 4.4-5.5 7.5-5.5s6.1 1.9 7.5 5.5" {...common} /></>,
    more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {paths[kind] || paths.home}
    </svg>
  );
}

const NAV_PRIMARY = [
  { to: "/feed", kind: "home", label: "Home" },
  { to: "/churches", kind: "search", label: "Search" },
  { to: "/prayer-wall", kind: "prayer", label: "Prayer" },
  { to: "/discussions", kind: "chat", label: "Discuss" },
  { to: "/profile", kind: "user", label: "Profile" },
];

const NAV_MORE = [
  { to: "/events", label: "Events" },
  { to: "/speakers", label: "Speakers" },
  { to: "/groups", label: "Groups" },
  { to: "/live", label: "Live Now" },
  { to: "/faithai", label: "FaithAI" },
];

/** Fixed bottom tab bar — rendered by ProtectedRoute, so it appears on every signed-in page automatically. */
function BottomNav() {
  const location = useLocation();
  const { logout } = useAuth();
  const [showMore, setShowMore] = useState(false);

  function isActive(to) {
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-black/5 bg-white/95 px-2 py-2 backdrop-blur">
        {NAV_PRIMARY.map((item) => {
          const active = isActive(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className="flex flex-col items-center gap-0.5 px-2 py-1"
              aria-current={active ? "page" : undefined}
            >
              <NavIcon
                kind={item.kind}
                className={`h-6 w-6 ${active ? "text-[#174A7E]" : "text-[#17212B]/40"}`}
              />
              <span className={`text-[10px] font-medium ${active ? "text-[#174A7E]" : "text-[#17212B]/40"}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="flex flex-col items-center gap-0.5 px-2 py-1"
        >
          <NavIcon kind="more" className="h-6 w-6 text-[#17212B]/40" />
          <span className="text-[10px] font-medium text-[#17212B]/40">More</span>
        </button>
      </nav>

      {showMore && (
        <div
          className="fixed inset-0 z-40 flex items-end bg-black/40"
          onClick={() => setShowMore(false)}
        >
          <div
            className="w-full rounded-t-2xl bg-white p-4 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/10" />
            <div className="grid grid-cols-2 gap-2">
              {NAV_MORE.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setShowMore(false)}
                  className="rounded-xl bg-[#EEF5FB] px-4 py-3 text-center text-sm font-medium text-[#17212B] hover:bg-[#174A7E]/10"
                >
                  {item.label}
                </Link>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowMore(false);
                logout();
              }}
              className="mt-3 w-full rounded-xl border border-red-200 px-4 py-3 text-center text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Log out
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#EEF5FB]">
        <p className="text-sm text-[#17212B]/60">Loading your session…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <>
      {children}
      <BottomNav />
    </>
  );
}

// =====================================================================
// 4. LOGIN PAGE
// =====================================================================

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = location.state?.from?.pathname || "/feed";

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Enter both email and password.");
      return;
    }

    setSubmitting(true);
    try {
      await login(email, password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err?.message || "Couldn't sign you in. Check your details and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#EEF5FB]">
      <header className="bg-[#174A7E] px-6 py-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">FaithConnect</h1>
        <p className="mt-1 text-sm text-white/70">
          A digital home for Christian connection and growth.
        </p>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 py-10 sm:items-center">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5"
        >
          <h2 className="mb-6 text-lg font-semibold text-[#17212B]">Welcome back</h2>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="you@example.com"
            />
          </label>

          <label className="mb-2 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p role="alert" className="mb-4 mt-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-4 w-full rounded-lg bg-[#D9A72A] py-2.5 font-semibold text-[#17212B] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>

          <p className="mt-4 text-center text-sm text-[#17212B]/60">
            New here?{" "}
            <Link to="/register" className="font-medium text-[#174A7E] hover:underline">
              Create an account
            </Link>
          </p>
        </form>
      </main>
    </div>
  );
}

// =====================================================================
// 4B. REGISTER PAGE
// =====================================================================

function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!name || !email || !password) {
      setError("Fill in your name, email, and password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      // Adjust these field names to match your real UserCreate schema
      // (e.g. it may want `username` instead of `email`, or split first/last name).
      await register({ name, email, password });
      navigate("/feed", { replace: true });
    } catch (err) {
      setError(err?.message || "Couldn't create your account. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#EEF5FB]">
      <header className="bg-[#174A7E] px-6 py-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">FaithConnect</h1>
        <p className="mt-1 text-sm text-white/70">
          A digital home for Christian connection and growth.
        </p>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 py-10 sm:items-center">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5"
        >
          <h2 className="mb-6 text-lg font-semibold text-[#17212B]">Create your account</h2>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Full name</span>
            <input
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="Jane Doe"
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="you@example.com"
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="••••••••"
            />
          </label>

          <label className="mb-2 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Confirm password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p role="alert" className="mb-4 mt-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-4 w-full rounded-lg bg-[#D9A72A] py-2.5 font-semibold text-[#17212B] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creating account…" : "Create account"}
          </button>

          <p className="mt-4 text-center text-sm text-[#17212B]/60">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-[#174A7E] hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </main>
    </div>
  );
}

// =====================================================================
// 5. POST CARD
// =====================================================================

/**
 * PostOut has NO author name, no like_count, no liked_by_me — only
 * { id, church_id, author_user_id, body, visibility, created_at }. So this
 * component fetches its own like count + like status on mount (two extra
 * requests per post, since there's no bulk endpoint for that), and shows
 * a short id instead of a name (see the shortId() note above).
 */
function PostCard({ post, onLikeChange }) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likeStateLoaded, setLikeStateLoaded] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiGetLikeCount(post.id), apiHasLiked(post.id)])
      .then(([countResult, hasLikedResult]) => {
        if (cancelled) return;
        // Both endpoints' response schemas are untyped ({} in the spec) —
        // handle either a bare value or a {count}/{liked} wrapper.
        const count =
          typeof countResult === "number" ? countResult : countResult?.count ?? 0;
        const hasLiked =
          typeof hasLikedResult === "boolean" ? hasLikedResult : Boolean(hasLikedResult?.liked);
        setLikeCount(count);
        setLiked(hasLiked);
      })
      .catch(() => {
        /* Non-fatal — the like button still works, it just starts at 0/unliked. */
      })
      .finally(() => {
        if (!cancelled) setLikeStateLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [post.id]);

  async function handleToggleLike() {
    if (pending) return;

    const nextLiked = !liked;
    const previousLiked = liked;
    const previousCount = likeCount;

    setLiked(nextLiked);
    setLikeCount((c) => c + (nextLiked ? 1 : -1));
    setPending(true);

    try {
      if (nextLiked) {
        await apiLikePost(post.id);
      } else {
        await apiUnlikePost(post.id);
      }
      onLikeChange?.(post.id, nextLiked);
    } catch {
      setLiked(previousLiked);
      setLikeCount(previousCount);
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <header className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-[#17212B]">
          {shortId(post.author_user_id)}
        </span>
        {post.created_at && (
          <time className="text-xs text-[#17212B]/50" dateTime={post.created_at}>
            {new Date(post.created_at).toLocaleDateString()}
          </time>
        )}
      </header>

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#17212B]">
        {post.body}
      </p>

      <footer className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleToggleLike}
          disabled={pending || !likeStateLoaded}
          aria-pressed={liked}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
            liked ? "bg-[#D9A72A] text-[#17212B]" : "bg-[#174A7E] text-white hover:opacity-90"
          }`}
        >
          <span aria-hidden="true">{liked ? "★" : "☆"}</span>
          {liked ? "Liked" : "Like"}
          {likeCount > 0 && <span className="opacity-80">· {likeCount}</span>}
        </button>
      </footer>
    </article>
  );
}

// =====================================================================
// 6. CREATE POST FORM
// =====================================================================

function CreatePostForm({ churchId, onPostCreated }) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const trimmed = content.trim();
    if (!trimmed) return;

    if (!churchId) {
      setError("No church selected — can't post without a church_id.");
      return;
    }

    setSubmitting(true);
    try {
      const newPost = await apiCreatePost(churchId, { body: trimmed, visibility: "church_only" });
      setContent("");
      onPostCreated?.(newPost);
    } catch (err) {
      setError(err?.message || "Couldn't publish that post. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5"
    >
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Share something with your church…"
        rows={3}
        className="w-full resize-none rounded-lg border border-[#17212B]/15 p-3 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
      />

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={submitting || !content.trim()}
          className="rounded-lg bg-[#D9A72A] px-4 py-2 text-sm font-semibold text-[#17212B] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}

// =====================================================================
// 7. FEED PAGE
// =====================================================================

/**
 * UserOut has no "home church" field at all — a user's church memberships
 * only exist as separate MembershipOut rows (from GET /users/{id}/churches),
 * and the API lets someone belong to more than one church. So instead of
 * assuming a single church, this page loads the user's ACTIVE memberships,
 * fetches each church's name (MembershipOut only has a church_id, not a
 * name), and — if there's more than one — lets them pick which church to
 * post into.
 */
function FeedPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [myChurches, setMyChurches] = useState([]); // [{ id, name }]
  const [selectedChurchId, setSelectedChurchId] = useState("");

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiGetPublicFeed({ limit: 20, offset: 0 });
      setPosts(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Couldn't load the feed. Pull to refresh or try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  // Load which churches this user actively belongs to, with names.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    apiGetUserChurchHistory(user.id)
      .then(async (history) => {
        const activeIds = (Array.isArray(history) ? history : [])
          .filter((m) => !m.left_at && m.status !== "removed")
          .map((m) => m.church_id);

        const churches = await Promise.all(
          activeIds.map((id) =>
            apiGetChurch(id)
              .then((c) => ({ id, name: c?.name || id }))
              .catch(() => ({ id, name: id }))
          )
        );

        if (!cancelled) {
          setMyChurches(churches);
          if (churches.length > 0) setSelectedChurchId(churches[0].id);
        }
      })
      .catch(() => {
        /* Non-fatal — the page just won't offer a "post" box. */
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  function handlePostCreated(newPost) {
    setPosts((prev) => [newPost, ...prev]);
  }

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="flex items-center justify-between bg-[#174A7E] px-4 py-4 sm:px-6">
        <h1 className="text-lg font-semibold text-white">FaithConnect</h1>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:px-6">
        {selectedChurchId ? (
          <>
            {myChurches.length > 1 && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[#17212B]/50">
                  Post as
                </span>
                <select
                  value={selectedChurchId}
                  onChange={(e) => setSelectedChurchId(e.target.value)}
                  className="w-full rounded-lg border border-[#17212B]/15 bg-white px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
                >
                  {myChurches.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <CreatePostForm churchId={selectedChurchId} onPostCreated={handlePostCreated} />
            <Link
              to={`/churches/${selectedChurchId}/timeline`}
              className="text-center text-sm font-medium text-[#174A7E] hover:underline"
            >
              View this church's full timeline →
            </Link>
          </>
        ) : (
          <p className="rounded-lg bg-white/60 p-3 text-center text-xs text-[#17212B]/60 ring-1 ring-black/5">
            <Link to="/churches" className="font-medium text-[#174A7E] hover:underline">
              Join a church
            </Link>{" "}
            to post to the feed.
          </p>
        )}

        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading feed…</p>}

        {!loading && error && (
          <div className="rounded-lg bg-white p-4 text-center ring-1 ring-black/5">
            <p className="mb-3 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={loadFeed}
              className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && posts.length === 0 && (
          <div className="rounded-lg bg-white p-8 text-center ring-1 ring-black/5">
            <p className="text-sm text-[#17212B]/60">
              No posts yet — be the first to share something.
            </p>
          </div>
        )}

        {!loading && !error && posts.map((post) => <PostCard key={post.id} post={post} />)}
      </main>
    </div>
  );
}

// =====================================================================
// 7B. CHURCH TIMELINE PAGE
// =====================================================================

const TIMELINE_PAGE_SIZE = 20;

/**
 * Protected page showing a single church's full timeline (every post,
 * regardless of visibility flag) with "Load more" pagination.
 * Route: /churches/:churchId/timeline
 */
function ChurchTimelinePage() {
  const { churchId } = useParams();
  const { user } = useAuth();

  const [church, setChurch] = useState(null);
  const [posts, setPosts] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const [loading, setLoading] = useState(true); // initial load
  const [loadingMore, setLoadingMore] = useState(false); // "load more" clicks
  const [error, setError] = useState("");

  // Load the church's name/details once.
  useEffect(() => {
    let cancelled = false;
    apiGetChurch(churchId)
      .then((data) => {
        if (!cancelled) setChurch(data);
      })
      .catch(() => {
        /* Non-fatal — the timeline still works without the header info. */
      });
    return () => {
      cancelled = true;
    };
  }, [churchId]);

  const loadPage = useCallback(
    async (targetOffset, { append }) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError("");
      }

      try {
        const data = await apiGetChurchTimeline(churchId, {
          limit: TIMELINE_PAGE_SIZE,
          offset: targetOffset,
        });
        const page = Array.isArray(data) ? data : [];

        setPosts((prev) => (append ? [...prev, ...page] : page));
        setOffset(targetOffset + page.length);
        setHasMore(page.length === TIMELINE_PAGE_SIZE);
      } catch (err) {
        setError(err?.message || "Couldn't load this church's timeline.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [churchId]
  );

  // Reset and reload whenever the church_id in the URL changes.
  useEffect(() => {
    setPosts([]);
    setOffset(0);
    setHasMore(true);
    loadPage(0, { append: false });
  }, [churchId, loadPage]);

  function handlePostCreated(newPost) {
    setPosts((prev) => [newPost, ...prev]);
  }

  // UserOut has no "home church" field — determine membership from the
  // user's actual church history instead of a field that doesn't exist.
  const [isOwnChurch, setIsOwnChurch] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    apiGetUserChurchHistory(user.id)
      .then((history) => {
        if (cancelled) return;
        const active = (Array.isArray(history) ? history : []).some(
          (m) => m.church_id === churchId && !m.left_at && m.status !== "removed"
        );
        setIsOwnChurch(active);
      })
      .catch(() => {
        /* Non-fatal — Manage/post-composer links just won't show. */
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, churchId]);

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between">
          <Link to="/feed" className="text-sm font-medium text-white/70 hover:text-white">
            ← Back to feed
          </Link>
          <Link
            to={`/churches/${churchId}/chat`}
            className="text-sm font-medium text-white/90 hover:text-white"
          >
            Group Chat →
          </Link>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-white">
            {church?.name || "Church timeline"}
          </h1>
          <div className="flex items-center gap-3">
            {isOwnChurch && (
              <Link
                to={`/churches/${churchId}/manage`}
                className="text-sm font-medium text-white/90 hover:text-white"
              >
                Manage →
              </Link>
            )}
            <Link
              to={`/churches/${churchId}/stories`}
              className="text-sm font-medium text-white/90 hover:text-white"
            >
              Stories →
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:px-6">
        {isOwnChurch && (
          <CreatePostForm churchId={churchId} onPostCreated={handlePostCreated} />
        )}

        {loading && (
          <p className="py-8 text-center text-sm text-[#17212B]/50">Loading timeline…</p>
        )}

        {!loading && error && (
          <div className="rounded-lg bg-white p-4 text-center ring-1 ring-black/5">
            <p className="mb-3 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => loadPage(0, { append: false })}
              className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && posts.length === 0 && (
          <div className="rounded-lg bg-white p-8 text-center ring-1 ring-black/5">
            <p className="text-sm text-[#17212B]/60">
              No posts on this timeline yet.
            </p>
          </div>
        )}

        {!loading && !error && posts.map((post) => <PostCard key={post.id} post={post} />)}

        {!loading && !error && hasMore && posts.length > 0 && (
          <button
            type="button"
            onClick={() => loadPage(offset, { append: true })}
            disabled={loadingMore}
            className="mx-auto rounded-lg border border-[#174A7E]/20 bg-white px-4 py-2 text-sm font-medium text-[#174A7E] hover:bg-[#174A7E]/5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </main>
    </div>
  );
}

// =====================================================================
// 7C. LANDING PAGE (public)
// =====================================================================
//
// NOTE ON SCOPE: several things shown here — Bible Hub, Live Streaming,
// Learning Academy, Christian Marketplace, Giving, Missions & Outreach —
// are NOT in the openapi.json spec we have (only auth, churches,
// memberships, tags, group-chat messages, stories, posts, and feed/likes
// are real endpoints today). This page sells the full vision, so those
// cards are marked "Coming soon" rather than linked anywhere, so nothing
// promises functionality the backend can't deliver yet. As those
// endpoints ship, swap the card's onClick/Link in and drop the badge.

/**
 * Small reusable mark: concentric rings, one gathering point rippling
 * outward. Used large and faint in the hero, then small again in the
 * footer, so it reads as a signature rather than a one-off decoration.
 */
function ConnectionMark({ className = "" }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" className={className} aria-hidden="true">
      <circle cx="60" cy="60" r="6" fill="#D9A72A" />
      <circle cx="60" cy="60" r="22" stroke="#D9A72A" strokeWidth="1.5" opacity="0.55" />
      <circle cx="60" cy="60" r="40" stroke="#174A7E" strokeWidth="1.5" opacity="0.35" />
      <circle cx="60" cy="60" r="58" stroke="#174A7E" strokeWidth="1.5" opacity="0.18" />
    </svg>
  );
}

/**
 * Abstract globe — latitude/longitude arcs plus small dots standing in for
 * people scattered across places. Deliberately not a cross, dove, fish, or
 * any single tradition's symbol, since the section it illustrates is about
 * many traditions gathered around one purpose, not one denomination's look.
 */
function GlobeMark({ className = "" }) {
  return (
    <svg viewBox="0 0 200 200" fill="none" className={className} aria-hidden="true">
      <circle cx="100" cy="100" r="72" stroke="#174A7E" strokeWidth="1.5" opacity="0.5" />
      <ellipse cx="100" cy="100" rx="72" ry="26" stroke="#174A7E" strokeWidth="1.2" opacity="0.35" />
      <ellipse cx="100" cy="100" rx="72" ry="50" stroke="#174A7E" strokeWidth="1.2" opacity="0.3" />
      <line x1="28" y1="100" x2="172" y2="100" stroke="#174A7E" strokeWidth="1.2" opacity="0.3" />
      <line x1="100" y1="28" x2="100" y2="172" stroke="#174A7E" strokeWidth="1.2" opacity="0.25" />
      {[
        [70, 55],
        [138, 72],
        [55, 128],
        [128, 138],
        [100, 40],
        [160, 105],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={i % 2 === 0 ? 5 : 4} fill="#D9A72A" opacity={0.9} />
      ))}
    </svg>
  );
}

/** Minimal, dependency-free glyph set — one simple stroke icon per feature/audience card. */
function FeatureGlyph({ kind, className = "" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    social: <><path d="M5 8a3 3 0 1 1 6 0 3 3 0 0 1-6 0Z" {...common} /><path d="M2 19c0-3 2.5-5 6-5s6 2 6 5" {...common} /><path d="M14 8a2.4 2.4 0 1 1 4.8 0" {...common} /><path d="M15 19c.3-2.4 2-4 4-4.4" {...common} /></>,
    church: <><path d="M4 20h16" {...common} /><path d="M6 20V10l6-5 6 5v10" {...common} /><path d="M10 20v-6h4v6" {...common} /><path d="M12 3v3" {...common} /><path d="M10.5 4.5h3" {...common} /></>,
    prayer: <><path d="M12 21c-4-2.5-7-6-7-10a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 4-3 7.5-7 10Z" {...common} /></>,
    live: <><rect x="3" y="6" width="14" height="12" rx="2" {...common} /><path d="M17 10l4-2.5v9L17 14" {...common} /></>,
    bible: <><path d="M4 5c2-1 5-1 7 .5V19c-2-1.5-5-1.5-7-.5Z" {...common} /><path d="M20 5c-2-1-5-1-7 .5V19c2-1.5 5-1.5 7-.5Z" {...common} /></>,
    academy: <><path d="M12 5 2 9l10 4 10-4Z" {...common} /><path d="M6 11v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5" {...common} /></>,
    events: <><rect x="3" y="5" width="18" height="15" rx="2" {...common} /><path d="M3 10h18" {...common} /><path d="M8 3v4M16 3v4" {...common} /></>,
    marketplace: <><path d="M4 8h16l-1.5 10a2 2 0 0 1-2 1.7H7.5a2 2 0 0 1-2-1.7Z" {...common} /><path d="M8 8V6a4 4 0 0 1 8 0v2" {...common} /></>,
    discussions: <><path d="M4 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10l-5 4v-4H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" {...common} /></>,
    media: <><rect x="3" y="4" width="18" height="13" rx="2" {...common} /><path d="M3 17l5-5 4 4 3-3 6 6" {...common} /></>,
    giving: <><path d="M12 8v13" {...common} /><path d="M8 21h8" {...common} /><rect x="4" y="4" width="16" height="7" rx="2" {...common} /><path d="M12 4v0" {...common} /></>,
    missions: <><path d="M12 21s7-5.5 7-11a7 7 0 0 0-14 0c0 5.5 7 11 7 11Z" {...common} /><circle cx="12" cy="10" r="2.5" {...common} /></>,
    believer: <><path d="M12 21c-4-2.5-7-6-7-10a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 4-3 7.5-7 10Z" {...common} /></>,
    professional: <><rect x="4" y="7" width="16" height="12" rx="2" {...common} /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" {...common} /></>,
    creator: <><rect x="3" y="4" width="18" height="13" rx="2" {...common} /><path d="M10 9.5 15 12l-5 2.5Z" {...common} /></>,
    organization: <><path d="M4 20V9l8-5 8 5v11" {...common} /><path d="M9 20v-6h6v6" {...common} /></>,
  };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {paths[kind] || paths.social}
    </svg>
  );
}

const FEATURE_GRID = [
  { kind: "social", title: "Social Community", body: "Post, follow, and connect with believers worldwide." },
  { kind: "church", title: "Church Hub", body: "Every church gets a verified home base for its members." },
  { kind: "prayer", title: "Prayer Network", body: "Share requests and stand with people praying in real time." },
  { kind: "live", title: "Live Streaming", body: "Join services and worship nights as they happen." },
  { kind: "bible", title: "Bible Hub", body: "Read, highlight, and study scripture together." },
  { kind: "academy", title: "Learning Academy", body: "Courses on discipleship, theology, and ministry skills." },
  { kind: "events", title: "Events", body: "Find retreats, conferences, and gatherings near you." },
  { kind: "marketplace", title: "Christian Marketplace", body: "Discover goods and services from Christian creators." },
  { kind: "discussions", title: "Discussions", body: "Ask questions and go deeper on faith topics that matter to you." },
  { kind: "media", title: "Blogs & Media", body: "Articles, testimonies, and media from across the Church." },
  { kind: "giving", title: "Giving", body: "Support your church or a cause with a few taps." },
  { kind: "missions", title: "Missions & Outreach", body: "Find and support mission work happening globally." },
];

const FOR_EVERYONE = [
  { kind: "believer", title: "Believers", body: "A home base for your walk — community, prayer, and growth in one place." },
  { kind: "church", title: "Churches", body: "Reach your congregation between Sundays with a verified digital presence." },
  { kind: "missions", title: "Ministries", body: "Share your work and connect with supporters and volunteers globally." },
  { kind: "professional", title: "Christian Professionals", body: "Network with others living out their faith at work." },
  { kind: "creator", title: "Christian Creators", body: "Reach an audience already looking for faith-centered content." },
  { kind: "organization", title: "Christian Organizations", body: "Coordinate outreach, events, and giving in one connected place." },
];

/** Endpoints that exist today vs. the fuller vision — see the NOTE above the page. */
const LIVE_FEATURE_TITLES = new Set(["Social Community", "Church Hub"]);

/** A stripped-down phone frame used three times in the hero, each showing a different screen. */
function PhoneMock({ label, accent = "#174A7E", children, className = "" }) {
  return (
    <div
      className={`w-40 shrink-0 rounded-[1.75rem] border-4 border-[#17212B] bg-white p-1.5 shadow-xl sm:w-48 ${className}`}
    >
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="h-1 w-6 rounded-full bg-[#17212B]/20" />
        <span className="text-[9px] font-semibold uppercase tracking-wide text-[#17212B]/40">
          {label}
        </span>
      </div>
      <div className="h-52 overflow-hidden rounded-2xl sm:h-64" style={{ backgroundColor: "#EEF5FB" }}>
        <div className="h-2 w-full" style={{ backgroundColor: accent }} />
        <div className="space-y-2 p-2.5">{children}</div>
      </div>
    </div>
  );
}

function LandingPage() {
  const { isAuthenticated } = useAuth();

  // Real data for the "Feed" phone mockup — /feed is a genuine public
  // endpoint, so this preview isn't fabricated like the Prayer Room/Bible
  // Hub ones (those aren't real endpoints yet, see the NOTE above).
  const [heroPosts, setHeroPosts] = useState([]);
  const [heroFeedLoading, setHeroFeedLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiGetPublicFeed({ limit: 2 })
      .then((data) => {
        if (!cancelled) setHeroPosts(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        /* Non-fatal — the mockup just shows its empty state. */
      })
      .finally(() => {
        if (!cancelled) setHeroFeedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-white text-[#17212B]">
      {/* ---- Top nav ---- */}
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span
          className="text-lg font-semibold tracking-tight text-[#174A7E]"
          style={{ fontFamily: "'Fraunces', serif" }}
        >
          FaithConnect
        </span>
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <Link
              to="/feed"
              className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Go to feed
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden text-sm font-medium text-[#17212B]/70 hover:text-[#17212B] sm:inline"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                className="rounded-lg bg-[#D9A72A] px-4 py-2 text-sm font-semibold text-[#17212B] hover:opacity-90"
              >
                Join — it's free
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* =================================================================
          HERO
      ================================================================== */}
      <header className="relative mx-auto max-w-6xl overflow-hidden px-6 pb-16 pt-6 sm:pb-24 sm:pt-10">
        <ConnectionMark className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 sm:h-[26rem] sm:w-[26rem]" />

        <div className="relative grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          {/* Copy */}
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-[#D9A72A]">
              For every believer, every church, everywhere
            </p>
            <h1
              className="mt-4 text-4xl leading-[1.1] text-[#17212B] sm:text-5xl"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              The Digital Home of the Global Church
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#17212B]/70">
              Connect with believers, churches and ministries around the
              world. Grow in faith, join meaningful conversations, pray
              together, discover events, learn, serve and make an impact.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to={isAuthenticated ? "/feed" : "/register"}
                className="rounded-lg bg-[#174A7E] px-6 py-3 text-sm font-semibold text-white hover:opacity-90"
              >
                {isAuthenticated ? "Go to feed" : "Join FaithConnect — It's Free"}
              </Link>
              <a
                href="#everything"
                className="rounded-lg border border-[#174A7E]/25 px-6 py-3 text-sm font-semibold text-[#174A7E] hover:bg-[#174A7E]/5"
              >
                Explore FaithConnect
              </a>
            </div>
          </div>

          {/* Phone mockups: Feed (real data), Prayer Room + Bible Hub (previews — not real endpoints yet) */}
          <div className="relative flex items-center justify-center gap-3 py-6 sm:gap-4">
            <PhoneMock label="Prayer Room · Preview" accent="#D9A72A" className="hidden -rotate-6 translate-y-4 sm:block">
              <div className="rounded-lg bg-white p-2 text-[9px] text-[#17212B]/70 shadow-sm">
                🇰🇪 Praying for healing
              </div>
              <div className="rounded-lg bg-white p-2 text-[9px] text-[#17212B]/70 shadow-sm">
                🇵🇭 Praying for provision
              </div>
              <div className="rounded-lg bg-[#D9A72A]/15 p-2 text-center text-[9px] font-medium text-[#17212B]/60">
                Coming soon
              </div>
            </PhoneMock>

            <PhoneMock label="Feed" accent="#174A7E" className="z-10 shadow-2xl">
              {heroFeedLoading && (
                <>
                  <div className="rounded-lg bg-white p-2 shadow-sm">
                    <div className="mb-1 h-1.5 w-16 rounded-full bg-[#17212B]/15" />
                    <div className="h-1.5 w-24 rounded-full bg-[#17212B]/10" />
                  </div>
                  <div className="rounded-lg bg-white p-2 shadow-sm">
                    <div className="mb-1 h-1.5 w-20 rounded-full bg-[#17212B]/15" />
                    <div className="h-1.5 w-14 rounded-full bg-[#17212B]/10" />
                  </div>
                </>
              )}

              {!heroFeedLoading && heroPosts.length === 0 && (
                <div className="rounded-lg bg-white p-2 text-[9px] text-[#17212B]/50 shadow-sm">
                  Real posts from the FaithConnect feed show up here.
                </div>
              )}

              {!heroFeedLoading &&
                heroPosts.map((post) => (
                  <div key={post.id} className="rounded-lg bg-white p-2 shadow-sm">
                    <p className="line-clamp-2 text-[9px] leading-snug text-[#17212B]/75">
                      {post.body}
                    </p>
                    <p className="mt-1 truncate text-[8px] font-medium text-[#17212B]/40">
                      {shortId(post.author_user_id)}
                    </p>
                  </div>
                ))}
            </PhoneMock>

            <PhoneMock label="Bible Hub · Preview" accent="#174A7E" className="hidden rotate-6 translate-y-4 sm:block">
              <div className="rounded-lg bg-white p-2 text-[9px] leading-snug text-[#17212B]/70 shadow-sm">
                Read and study scripture together.
              </div>
              <div className="rounded-lg bg-[#174A7E]/10 p-2 text-center text-[9px] font-medium text-[#17212B]/60">
                Coming soon
              </div>
            </PhoneMock>
          </div>
        </div>
      </header>

      {/* =================================================================
          EVERYTHING YOU NEED
      ================================================================== */}
      <section id="everything" className="bg-[#EEF5FB] px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <h2
            className="max-w-lg text-2xl text-[#17212B] sm:text-3xl"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            Everything you need. All in one place.
          </h2>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_GRID.map((feature) => (
              <div
                key={feature.title}
                className="relative rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"
              >
                {!LIVE_FEATURE_TITLES.has(feature.title) && (
                  <span className="absolute right-4 top-4 rounded-full bg-[#17212B]/5 px-2 py-0.5 text-[10px] font-medium text-[#17212B]/40">
                    Coming soon
                  </span>
                )}
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#174A7E]/10 text-[#174A7E]">
                  <FeatureGlyph kind={feature.kind} className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-[#17212B]">{feature.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#17212B]/60">{feature.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =================================================================
          ONE FAITH. MANY VOICES.
      ================================================================== */}
      <section className="px-6 py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1fr_1fr]">
          <div className="order-2 flex justify-center lg:order-1">
            <GlobeMark className="h-64 w-64 sm:h-80 sm:w-80" />
          </div>
          <div className="order-1 lg:order-2">
            <h2
              className="text-2xl text-[#17212B] sm:text-3xl"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              One faith. Many voices. Global impact.
            </h2>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-[#17212B]/70">
              People from different nations, cultures, and denominations
              coming together for one purpose — Jesus. FaithConnect isn't
              built for one tradition or one corner of the world; it's built
              for the whole, global Church.
            </p>
          </div>
        </div>
      </section>

      {/* =================================================================
          WHY FAITHCONNECT
      ================================================================== */}
      <section className="bg-[#174A7E] px-6 py-16 text-white sm:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl sm:text-3xl" style={{ fontFamily: "'Fraunces', serif" }}>
            Why FaithConnect?
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/75">
            Mainstream social platforms weren't built around fellowship,
            discipleship, prayer, or ministry — faith is an afterthought
            bolted onto feeds designed for something else entirely.
            FaithConnect starts from the opposite direction: every feature
            here exists because the global Church actually needs it.
          </p>
        </div>
      </section>

      {/* =================================================================
          FOR EVERYONE
      ================================================================== */}
      <section className="px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <h2
            className="text-2xl text-[#17212B] sm:text-3xl"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            For everyone in the Church.
          </h2>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FOR_EVERYONE.map((card) => (
              <div
                key={card.title}
                className="rounded-2xl bg-[#EEF5FB] p-5 ring-1 ring-black/5"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#D9A72A] shadow-sm">
                  <FeatureGlyph kind={card.kind} className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-[#17212B]">{card.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#17212B]/60">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =================================================================
          PRAYER NETWORK
      ================================================================== */}
      <section className="bg-[#EEF5FB] px-6 py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2
              className="text-2xl text-[#17212B] sm:text-3xl"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              You don't have to pray alone.
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-[#17212B]/70">
              Share a request and watch people from around the world stand
              with you in real time — a live room where distance never gets
              in the way of standing together in prayer.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-lg ring-1 ring-black/5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#17212B]/40">
                Prayer Room
              </span>
              <span className="rounded-full bg-[#17212B]/5 px-2 py-0.5 text-[10px] font-medium text-[#17212B]/40">
                Preview — coming soon
              </span>
            </div>
            <ul className="space-y-2.5">
              {[
                ["🇧🇷", "Brazil", "praying for their family"],
                ["🇳🇬", "Nigeria", "praying for a new job"],
                ["🇵🇭", "Philippines", "praying for healing"],
                ["🇺🇸", "United States", "praying for their church"],
                ["🇰🇷", "South Korea", "praying for the persecuted Church"],
              ].map(([flag, place, need]) => (
                <li key={place} className="flex items-center gap-3 rounded-lg bg-[#EEF5FB] px-3 py-2">
                  <span className="text-lg" aria-hidden="true">{flag}</span>
                  <span className="text-sm text-[#17212B]/70">
                    <span className="font-medium text-[#17212B]">{place}</span> — {need}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-center text-xs text-[#17212B]/40">
              An illustration of what the Prayer Network will look like.
            </p>
          </div>
        </div>
      </section>

      {/* =================================================================
          CHURCH & MINISTRY HUB
      ================================================================== */}
      <section className="px-6 py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl bg-[#174A7E] p-6 text-white shadow-lg lg:order-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/50">
              Church Hub preview
            </p>
            <div className="mt-3 rounded-xl bg-white/10 p-4">
              <div className="mb-2 h-2 w-32 rounded-full bg-white/30" />
              <div className="h-2 w-20 rounded-full bg-white/20" />
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[10px] text-white/70">
                <div className="rounded-lg bg-white/10 py-2">Live now</div>
                <div className="rounded-lg bg-white/10 py-2">Sermons</div>
                <div className="rounded-lg bg-white/10 py-2">Events</div>
              </div>
            </div>
          </div>

          <div className="lg:order-1">
            <h2
              className="text-2xl text-[#17212B] sm:text-3xl"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              A home base for your church.
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-[#17212B]/70">
              Create your church's page, go live for a service, publish
              sermons, announce events, and stay connected with your
              members — all from one verified hub they already trust.
            </p>
          </div>
        </div>
      </section>

      {/* =================================================================
          FINAL CTA
      ================================================================== */}
      <section className="px-6 pb-16 sm:pb-20">
        <div className="mx-auto max-w-6xl rounded-2xl bg-[#174A7E] p-10 text-center sm:p-16">
          <h2
            className="text-2xl text-white sm:text-4xl"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            Your faith. Your community. Your global connection.
          </h2>
          <Link
            to={isAuthenticated ? "/feed" : "/register"}
            className="mt-8 inline-block rounded-lg bg-[#D9A72A] px-8 py-3.5 text-sm font-semibold text-[#17212B] hover:opacity-90"
          >
            {isAuthenticated ? "Go to feed" : "Join FaithConnect — It's Free"}
          </Link>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 pb-12 pt-4 text-center">
        <ConnectionMark className="h-10 w-10" />
        <p className="text-xs text-[#17212B]/50">
          FaithConnect — the digital home of the global Church.
        </p>
      </footer>
    </div>
  );
}

// =====================================================================
// 7D. PROFILE PAGE
// =====================================================================

/**
 * Read-only account overview: who you are, and every church you've ever
 * belonged to (active + past). The API's UserOut schema doesn't include a
 * profile-edit endpoint in the spec we have, so this page doesn't invent
 * one — it's a summary + membership history + sign-out, not a settings form.
 * If your backend adds a PATCH /auth/me later, an edit form slots in here.
 */
/**
 * Read-only account overview: who you are, and every church you've ever
 * belonged to (active + past). The API's UserOut schema doesn't include a
 * profile-edit endpoint in the spec we have, so this page doesn't invent
 * one — it's a summary + membership history + sign-out, not a settings form.
 * If your backend adds a PATCH /auth/me later, an edit form slots in here.
 *
 * AVATAR NOTE: uploading is real — the file genuinely goes to POST
 * /uploads and gets back a real MediaOut with a real URL. What's NOT real
 * is attaching it to the account: the spec has no PATCH /auth/me (or any
 * other endpoint) to save "this media is my avatar" server-side. So the
 * uploaded URL is only remembered in this browser's localStorage, keyed
 * by user id — it'll show here again next time you open the app on this
 * device, but won't show to anyone else, and won't follow you to another
 * device. Once the backend adds a real "set my avatar" endpoint, replace
 * the localStorage read/write below with a call to it.
 */
const AVATAR_STORAGE_PREFIX = "faithconnect_avatar_";

function ProfilePage() {
  const { user, logout } = useAuth();
  const [history, setHistory] = useState([]);
  const [churchNames, setChurchNames] = useState({}); // church_id -> name
  const [loadingChurches, setLoadingChurches] = useState(true);
  const [error, setError] = useState("");

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  const [tab, setTab] = useState("posts"); // "posts" | "churches"
  const [myPosts, setMyPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(true);

  // Load whatever avatar URL was saved locally for this user, if any.
  useEffect(() => {
    if (!user?.id) return;
    try {
      const saved = localStorage.getItem(`${AVATAR_STORAGE_PREFIX}${user.id}`);
      if (saved) setAvatarUrl(saved);
    } catch {
      /* localStorage unavailable — avatar just won't persist, non-fatal. */
    }
  }, [user?.id]);

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    setUploadingAvatar(true);
    setAvatarError("");
    try {
      const media = await apiUploadMedia(file); // real upload, real URL back
      const url = media?.url;
      if (url) {
        setAvatarUrl(url);
        try {
          localStorage.setItem(`${AVATAR_STORAGE_PREFIX}${user.id}`, url);
        } catch {
          /* Non-fatal — it'll just re-upload next session instead of persisting. */
        }
      }
    } catch (err) {
      setAvatarError(err?.message || "Couldn't upload that image.");
    } finally {
      setUploadingAvatar(false);
      e.target.value = ""; // allow re-selecting the same file later
    }
  }

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    setLoadingChurches(true);
    setError("");
    apiGetUserChurchHistory(user.id)
      .then(async (data) => {
        const rows = Array.isArray(data) ? data : [];
        if (cancelled) return;
        setHistory(rows);

        // MembershipOut only has church_id, no name — fetch each unique
        // church's real name (confirmed field on ChurchOut) in parallel.
        const uniqueIds = [...new Set(rows.map((m) => m.church_id))];
        const entries = await Promise.all(
          uniqueIds.map((id) =>
            apiGetChurch(id)
              .then((c) => [id, c?.name])
              .catch(() => [id, null])
          )
        );
        if (!cancelled) setChurchNames(Object.fromEntries(entries));

        // "My posts" isn't a real endpoint anywhere in the API — PostOut
        // has no author-filter query param. The only honest way to build
        // this is to pull each active church's timeline and filter client
        // side for posts this user actually authored.
        const activeIds = rows
          .filter((m) => !m.left_at && m.status !== "removed")
          .map((m) => m.church_id);
        setLoadingPosts(true);
        const perChurch = await Promise.all(
          activeIds.map((id) =>
            apiGetChurchTimeline(id, { limit: 50 }).catch(() => [])
          )
        );
        if (!cancelled) {
          const mine = perChurch
            .flat()
            .filter((p) => p.author_user_id === user.id)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          setMyPosts(mine);
          setLoadingPosts(false);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Couldn't load your profile data.");
      })
      .finally(() => {
        if (!cancelled) setLoadingChurches(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Confirmed against the real MembershipOut schema: status/left_at both exist.
  const activeMemberships = history.filter((m) => !m.left_at && m.status !== "removed");
  const pastMemberships = history.filter((m) => m.left_at || m.status === "removed");
  const memberSinceYear = user?.created_at ? new Date(user.created_at).getFullYear() : null;

  return (
    <div className="min-h-screen bg-white pb-20">
      <header className="border-b border-black/5 px-4 py-3 sm:px-6">
        <h1 className="text-base font-semibold text-[#17212B]">
          {user?.name || "Profile"}
        </h1>
      </header>

      <main className="mx-auto max-w-xl px-4 py-5 sm:px-6">
        {/* ---- Instagram-style header: avatar + stats ---- */}
        <div className="flex items-center gap-6">
          <label className="relative shrink-0 cursor-pointer">
            <input type="file" accept="image/*" onChange={handleAvatarChange} className="sr-only" />
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="h-20 w-20 rounded-full object-cover ring-2 ring-[#174A7E]/15"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#174A7E] text-2xl font-semibold text-white">
                {(user?.name || user?.email || "?").charAt(0).toUpperCase()}
              </div>
            )}
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#D9A72A] text-xs text-[#17212B] ring-2 ring-white">
              {uploadingAvatar ? "…" : "✎"}
            </span>
          </label>

          <div className="flex flex-1 justify-around text-center">
            <div>
              <p className="text-lg font-semibold text-[#17212B]">
                {loadingPosts ? "…" : myPosts.length}
              </p>
              <p className="text-xs text-[#17212B]/50">Posts</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-[#17212B]">
                {loadingChurches ? "…" : activeMemberships.length}
              </p>
              <p className="text-xs text-[#17212B]/50">Churches</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-[#17212B]">{memberSinceYear || "—"}</p>
              <p className="text-xs text-[#17212B]/50">Since</p>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-sm font-semibold text-[#17212B]">{user?.name}</p>
          <p className="text-sm text-[#17212B]/60">{user?.email}</p>
        </div>

        {avatarError && <p className="mt-2 text-xs text-red-600">{avatarError}</p>}

        <button
          type="button"
          onClick={logout}
          className="mt-4 w-full rounded-lg border border-black/10 py-2 text-sm font-medium text-[#17212B] hover:bg-black/5"
        >
          Log out
        </button>

        {error && <p className="mt-3 text-center text-sm text-red-600">{error}</p>}

        {/* ---- Tabs ---- */}
        <div className="mt-6 flex border-t border-black/10">
          <button
            type="button"
            onClick={() => setTab("posts")}
            className={`flex flex-1 items-center justify-center gap-1.5 border-t-2 py-3 text-xs font-semibold uppercase tracking-wide ${
              tab === "posts" ? "border-[#17212B] text-[#17212B]" : "border-transparent text-[#17212B]/35"
            }`}
          >
            <NavIcon kind="chat" className="h-4 w-4" /> Posts
          </button>
          <button
            type="button"
            onClick={() => setTab("churches")}
            className={`flex flex-1 items-center justify-center gap-1.5 border-t-2 py-3 text-xs font-semibold uppercase tracking-wide ${
              tab === "churches" ? "border-[#17212B] text-[#17212B]" : "border-transparent text-[#17212B]/35"
            }`}
          >
            <NavIcon kind="search" className="h-4 w-4" /> Churches
          </button>
        </div>

        {/* ---- Posts tab: a grid, since that reads as "profile grid" even
             though these are text posts, not photos — PostOut has no
             media field, see the NOT IMPLEMENTED-style notes elsewhere in
             this file for why. ---- */}
        {tab === "posts" && (
          <div className="mt-3">
            {loadingPosts && (
              <p className="py-8 text-center text-sm text-[#17212B]/50">Loading posts…</p>
            )}
            {!loadingPosts && myPosts.length === 0 && (
              <p className="py-8 text-center text-sm text-[#17212B]/50">
                No posts yet — anything you post to a church shows up here.
              </p>
            )}
            {!loadingPosts && myPosts.length > 0 && (
              <div className="grid grid-cols-3 gap-0.5">
                {myPosts.map((post) => (
                  <Link
                    key={post.id}
                    to={`/churches/${post.church_id}/timeline`}
                    className="aspect-square overflow-hidden bg-[#EEF5FB] p-2 hover:bg-[#174A7E]/10"
                  >
                    <p className="line-clamp-5 text-[10px] leading-snug text-[#17212B]/70">
                      {post.body}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- Churches tab ---- */}
        {tab === "churches" && (
          <div className="mt-3">
            {loadingChurches && (
              <p className="py-8 text-center text-sm text-[#17212B]/50">Loading churches…</p>
            )}

            {!loadingChurches && history.length === 0 && (
              <p className="py-8 text-center text-sm text-[#17212B]/60">
                You haven't joined a church yet.
              </p>
            )}

            {!loadingChurches && activeMemberships.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium uppercase tracking-wide text-[#17212B]/40">
                  Active
                </p>
                <ul className="mt-2 divide-y divide-black/5">
                  {activeMemberships.map((m) => (
                    <li key={m.id || m.church_id} className="flex items-center justify-between py-2.5">
                      <Link
                        to={`/churches/${m.church_id}/timeline`}
                        className="text-sm font-medium text-[#174A7E] hover:underline"
                      >
                        {churchNames[m.church_id] || m.church_id}
                      </Link>
                      <span className="rounded-full bg-[#D9A72A]/15 px-2 py-0.5 text-xs font-medium text-[#17212B]">
                        Member
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!loadingChurches && pastMemberships.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-[#17212B]/40">
                  Past
                </p>
                <ul className="mt-2 divide-y divide-black/5">
                  {pastMemberships.map((m) => (
                    <li key={m.id || m.church_id} className="flex items-center justify-between py-2.5">
                      <span className="text-sm text-[#17212B]/60">
                        {churchNames[m.church_id] || m.church_id}
                      </span>
                      <span className="text-xs text-[#17212B]/40">Left</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// =====================================================================
// 7E. BROWSE / JOIN CHURCHES PAGE
// =====================================================================

/**
 * Protected page listing all churches (optionally filtered by brand/network),
 * with a one-tap join for each. Cross-references the user's existing
 * membership history so already-joined churches show "Joined" instead of
 * a join button — a user can belong to more than one church, so this
 * isn't limited to a single "home church".
 * Route: /churches
 */
function BrowseChurchesPage() {
  const { user } = useAuth();

  const [brands, setBrands] = useState([]);
  const [selectedBrandId, setSelectedBrandId] = useState("");

  const [churches, setChurches] = useState([]);
  const [joinedIds, setJoinedIds] = useState(() => new Set());
  const [joiningId, setJoiningId] = useState(null); // church currently mid-join

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Brand/network filter options — load once.
  useEffect(() => {
    apiGetBrands()
      .then((data) => setBrands(Array.isArray(data) ? data : []))
      .catch(() => {
        /* Non-fatal — filter just won't have options if this fails. */
      });
  }, []);

  // Which churches the user is already an active member of.
  useEffect(() => {
    if (!user?.id) return;
    apiGetUserChurchHistory(user.id)
      .then((history) => {
        const active = (Array.isArray(history) ? history : [])
          .filter((m) => !m.left_at && m.status !== "removed")
          .map((m) => m.church_id);
        setJoinedIds(new Set(active));
      })
      .catch(() => {
        /* Non-fatal — worst case a "Join" button shows for an already-joined church. */
      });
  }, [user?.id]);

  const loadChurches = useCallback(async (brandId) => {
    setLoading(true);
    setError("");
    try {
      const data = await apiGetChurches(brandId ? { brandId } : {});
      setChurches(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Couldn't load churches. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChurches(selectedBrandId);
  }, [selectedBrandId, loadChurches]);

  async function handleJoin(churchId) {
    if (joiningId) return;
    setJoiningId(churchId);
    try {
      await apiJoinChurch(churchId);
      setJoinedIds((prev) => new Set(prev).add(churchId));
    } catch (err) {
      setError(err?.message || "Couldn't join that church. Try again.");
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between">
          <Link to="/feed" className="text-sm font-medium text-white/70 hover:text-white">
            ← Back to feed
          </Link>
          {user?.is_platform_admin && (
            <Link to="/churches/new" className="text-sm font-medium text-white/90 hover:text-white">
              + Start a church
            </Link>
          )}
        </div>
        <h1 className="mt-1 text-lg font-semibold text-white">Find a church</h1>
        {/*
          Discovered by testing, not documented in the API spec: POST /churches
          actually rejects non-admins ("Platform admin only"), even though only
          the verify endpoint's description mentions an admin restriction. So
          the create-church entry point is hidden here unless the account is
          flagged is_platform_admin — showing the button to everyone else would
          just walk them into a guaranteed 403.
        */}
        {!user?.is_platform_admin && (
          <p className="mt-1 text-xs text-white/50">
            Creating a new church requires a platform-admin account.
          </p>
        )}
      </header>

      <main className="mx-auto max-w-xl px-4 py-6 sm:px-6">
        {brands.length > 0 && (
          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[#17212B]/50">
              Filter by network
            </span>
            <select
              value={selectedBrandId}
              onChange={(e) => setSelectedBrandId(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 bg-white px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            >
              <option value="">All networks</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading churches…</p>}

        {!loading && error && (
          <div className="rounded-lg bg-white p-4 text-center ring-1 ring-black/5">
            <p className="mb-3 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => loadChurches(selectedBrandId)}
              className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && churches.length === 0 && (
          <div className="rounded-lg bg-white p-8 text-center ring-1 ring-black/5">
            <p className="text-sm text-[#17212B]/60">No churches found for this filter.</p>
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {!loading &&
            !error &&
            churches.map((church) => {
              const joined = joinedIds.has(church.id);
              const joining = joiningId === church.id;
              return (
                <li
                  key={church.id}
                  className="flex items-center justify-between gap-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/churches/${church.id}/timeline`}
                        className="truncate text-sm font-semibold text-[#17212B] hover:underline"
                      >
                        {church.name}
                      </Link>
                      {church.is_verified && (
                        <span className="shrink-0 rounded-full bg-[#D9A72A]/20 px-2 py-0.5 text-[10px] font-semibold text-[#17212B]">
                          Verified
                        </span>
                      )}
                    </div>
                    {church.description && (
                      <p className="mt-1 truncate text-xs text-[#17212B]/55">
                        {church.description}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleJoin(church.id)}
                    disabled={joined || joining}
                    className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                      joined
                        ? "bg-[#D9A72A]/20 text-[#17212B]"
                        : "bg-[#174A7E] text-white hover:opacity-90 disabled:opacity-60"
                    }`}
                  >
                    {joined ? "Joined" : joining ? "Joining…" : "Join"}
                  </button>
                </li>
              );
            })}
        </ul>
      </main>
    </div>
  );
}

// =====================================================================
// 7F. GROUP CHAT PAGE
// =====================================================================

const GC_PAGE_SIZE = 30;

/**
 * Protected group-chat page for a single church.
 * Route: /churches/:churchId/chat
 *
 * ASSUMPTION on message order: GET .../gc/messages with `limit`/`before`
 * reads like a typical chat pagination endpoint — newest messages first,
 * `before` taking a cursor (here, the oldest loaded message's `created_at`)
 * to page further into the past. The list is reversed for display so the
 * chat reads oldest-to-newest, newest at the bottom, same as any chat app.
 * If your real GCMessageOut/pagination behaves differently, flip the
 * `.reverse()` calls below and adjust the `before` cursor field.
 */
function GroupChatPage() {
  const { churchId } = useParams();
  const { user } = useAuth();

  const [church, setChurch] = useState(null);
  const [messages, setMessages] = useState([]); // oldest → newest, for display
  const [hasMore, setHasMore] = useState(true);
  const [draft, setDraft] = useState("");

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const bottomRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    apiGetChurch(churchId)
      .then((data) => {
        if (!cancelled) setChurch(data);
      })
      .catch(() => {
        /* Non-fatal — chat still works without the header name. */
      });
    return () => {
      cancelled = true;
    };
  }, [churchId]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiListGcMessages(churchId, { limit: GC_PAGE_SIZE });
      const page = Array.isArray(data) ? data : [];
      setMessages([...page].reverse());
      setHasMore(page.length === GC_PAGE_SIZE);
    } catch (err) {
      setError(err?.message || "Couldn't load the chat.");
    } finally {
      setLoading(false);
    }
  }, [churchId]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // Scroll to the newest message whenever the initial page finishes loading
  // or a new message is sent (not on "load older", which prepends above).
  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [loading]);

  async function loadOlder() {
    if (loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = messages[0];
      const data = await apiListGcMessages(churchId, {
        limit: GC_PAGE_SIZE,
        before: oldest.created_at || oldest.id,
      });
      const page = Array.isArray(data) ? data : [];
      setMessages((prev) => [...[...page].reverse(), ...prev]);
      setHasMore(page.length === GC_PAGE_SIZE);
    } catch (err) {
      setError(err?.message || "Couldn't load older messages.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError("");
    try {
      const newMessage = await apiSendGcMessage(churchId, { body: trimmed });
      setMessages((prev) => [...prev, newMessage]);
      setDraft("");
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: "end" }));
    } catch (err) {
      setError(err?.message || "Message didn't send. Try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(messageId) {
    // Optimistic removal, roll back if the server rejects it (e.g. not the author).
    const previous = messages;
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    try {
      await apiDeleteGcMessage(churchId, messageId);
    } catch (err) {
      setMessages(previous);
      setError(err?.message || "Couldn't delete that message.");
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#EEF5FB]">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between">
          <Link to={`/churches/${churchId}/timeline`} className="text-sm font-medium text-white/70 hover:text-white">
            ← Timeline
          </Link>
        </div>
        <h1 className="mt-1 text-lg font-semibold text-white">
          {church?.name ? `${church.name} — Group Chat` : "Group Chat"}
        </h1>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-4 sm:px-6">
        {!loading && !error && hasMore && messages.length > 0 && (
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingMore}
            className="mx-auto mb-3 rounded-lg border border-[#174A7E]/20 bg-white px-4 py-1.5 text-xs font-medium text-[#174A7E] hover:bg-[#174A7E]/5 disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load older messages"}
          </button>
        )}

        <div className="flex-1 space-y-2.5">
          {loading && (
            <p className="py-8 text-center text-sm text-[#17212B]/50">Loading chat…</p>
          )}

          {!loading && error && messages.length === 0 && (
            <div className="rounded-lg bg-white p-4 text-center ring-1 ring-black/5">
              <p className="mb-3 text-sm text-red-600">{error}</p>
              <button
                type="button"
                onClick={loadInitial}
                className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && messages.length === 0 && (
            <p className="py-8 text-center text-sm text-[#17212B]/60">
              No messages yet — say something to get the conversation going.
            </p>
          )}

          {!loading &&
            messages.map((msg) => {
              const isOwn = msg.author_user_id === user?.id;
              return (
                <div key={msg.id} className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`group max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                      isOwn ? "bg-[#174A7E] text-white" : "bg-white text-[#17212B] shadow-sm ring-1 ring-black/5"
                    }`}
                  >
                    {!isOwn && (
                      <p className="mb-0.5 text-xs font-semibold opacity-70">
                        {shortId(msg.author_user_id)}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      {msg.created_at && (
                        <time
                          className={`text-[10px] ${isOwn ? "text-white/60" : "text-[#17212B]/40"}`}
                        >
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      )}
                      {isOwn && (
                        <button
                          type="button"
                          onClick={() => handleDelete(msg.id)}
                          className="text-[10px] text-white/60 opacity-0 hover:text-white group-hover:opacity-100"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          <div ref={bottomRef} />
        </div>

        {error && messages.length > 0 && (
          <p className="mt-2 text-center text-xs text-red-600">{error}</p>
        )}

        <form onSubmit={handleSend} className="mt-4 flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message the group…"
            className="flex-1 rounded-full border border-[#17212B]/15 bg-white px-4 py-2.5 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="shrink-0 rounded-full bg-[#D9A72A] px-5 py-2.5 text-sm font-semibold text-[#17212B] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? "…" : "Send"}
          </button>
        </form>
      </main>
    </div>
  );
}

// =====================================================================
// 7G. STORIES PAGE
// =====================================================================

const STORY_DURATION_MS = 5000;

/**
 * Protected, church-scoped stories page: a tray of thumbnails up top, a
 * full-screen tap-through viewer, and a form to post a new story.
 * Route: /churches/:churchId/stories
 *
 * TWO REAL CONSTRAINTS FROM THE CONFIRMED SCHEMA:
 * 1. StoryCreate requires `media_id` — the API has no text-only stories,
 *    so the photo picker below is mandatory, not optional.
 * 2. StoryOut only returns `media_id` (an id), never a URL. There is no
 *    GET /media/{id} endpoint in the spec to resolve that id back into a
 *    displayable image. So only stories uploaded THIS session — where we
 *    still have the URL the upload endpoint just handed us — can actually
 *    show a photo; the mediaUrlCache below holds those. Stories loaded
 *    from the server (yours from an earlier session, or anyone else's)
 *    show a plain avatar placeholder with the caption instead of a broken
 *    image, since there's genuinely no way to fetch their photo yet.
 */
function StoriesPage() {
  const { churchId } = useParams();

  const [church, setChurch] = useState(null);
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // media_id -> url, populated only for uploads made in this session.
  const [mediaUrlCache, setMediaUrlCache] = useState({});

  const [viewerIndex, setViewerIndex] = useState(null); // null = viewer closed
  const [progress, setProgress] = useState(0);

  const [showForm, setShowForm] = useState(false);
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState(null);
  const [posting, setPosting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiGetChurch(churchId)
      .then((data) => {
        if (!cancelled) setChurch(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [churchId]);

  const loadStories = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiListActiveStories(churchId);
      setStories(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Couldn't load stories.");
    } finally {
      setLoading(false);
    }
  }, [churchId]);

  useEffect(() => {
    loadStories();
  }, [loadStories]);

  // ---- full-screen viewer: auto-advance every STORY_DURATION_MS ----
  useEffect(() => {
    if (viewerIndex === null) return;

    setProgress(0);
    const start = Date.now();
    const tick = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - start) / STORY_DURATION_MS) * 100);
      setProgress(pct);
    }, 50);
    const advance = setTimeout(() => {
      setViewerIndex((i) => {
        if (i === null) return i;
        return i + 1 < stories.length ? i + 1 : null; // close after the last one
      });
    }, STORY_DURATION_MS);

    return () => {
      clearInterval(tick);
      clearTimeout(advance);
    };
  }, [viewerIndex, stories.length]);

  function goPrev() {
    setViewerIndex((i) => (i !== null && i > 0 ? i - 1 : i));
  }
  function goNext() {
    setViewerIndex((i) => (i !== null && i + 1 < stories.length ? i + 1 : null));
  }

  async function handlePostStory(e) {
    e.preventDefault();
    if (!file) {
      setFormError("A photo is required — the API doesn't support text-only stories.");
      return;
    }

    setPosting(true);
    setFormError("");
    try {
      const media = await apiUploadMedia(file);
      const mediaId = media?.id;
      const newStory = await apiCreateStory(churchId, {
        media_id: mediaId,
        caption: caption.trim() || undefined,
      });
      // We have the real URL from THIS upload — cache it so the tray/viewer
      // can actually show it (see the constraint note above).
      if (media?.url && mediaId) {
        setMediaUrlCache((prev) => ({ ...prev, [mediaId]: media.url }));
      }
      setStories((prev) => [newStory, ...prev]);
      setCaption("");
      setFile(null);
      setShowForm(false);
    } catch (err) {
      setFormError(err?.message || "Couldn't post that story. Try again.");
    } finally {
      setPosting(false);
    }
  }

  const activeStory = viewerIndex !== null ? stories[viewerIndex] : null;

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to={`/churches/${churchId}/timeline`} className="text-sm font-medium text-white/70 hover:text-white">
          ← Timeline
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">
          {church?.name ? `${church.name} — Stories` : "Stories"}
        </h1>
      </header>

      <main className="mx-auto max-w-xl px-4 py-6 sm:px-6">
        {/* ---- Story tray ---- */}
        <div className="flex gap-4 overflow-x-auto pb-2">
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex shrink-0 flex-col items-center gap-1.5"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-[#174A7E]/40 text-2xl text-[#174A7E]">
              +
            </span>
            <span className="text-xs text-[#17212B]/60">Add story</span>
          </button>

          {loading && (
            <p className="self-center text-sm text-[#17212B]/50">Loading…</p>
          )}

          {!loading &&
            stories.map((story, index) => {
              const cachedUrl = mediaUrlCache[story.media_id];
              return (
                <button
                  key={story.id}
                  type="button"
                  onClick={() => setViewerIndex(index)}
                  className="flex shrink-0 flex-col items-center gap-1.5"
                >
                  <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full ring-2 ring-[#D9A72A] ring-offset-2">
                    {cachedUrl ? (
                      <img src={cachedUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-[#174A7E] text-lg font-semibold text-white">
                        {story.author_user_id ? story.author_user_id.slice(-1).toUpperCase() : "?"}
                      </span>
                    )}
                  </span>
                  <span className="max-w-[4rem] truncate text-xs text-[#17212B]/60">
                    {shortId(story.author_user_id)}
                  </span>
                </button>
              );
            })}
        </div>

        {!loading && error && (
          <div className="mt-4 rounded-lg bg-white p-4 text-center ring-1 ring-black/5">
            <p className="mb-3 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={loadStories}
              className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && stories.length === 0 && (
          <p className="mt-6 text-center text-sm text-[#17212B]/60">
            No active stories right now — be the first to share one.
          </p>
        )}
      </main>

      {/* ---- Add-story form (simple modal) ---- */}
      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <form
            onSubmit={handlePostStory}
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
          >
            <h2 className="mb-3 text-sm font-semibold text-[#17212B]">New story</h2>

            <label className="block text-xs font-medium text-[#17212B]/60">
              Photo <span className="text-red-500">*</span> — required, the API doesn't
              support text-only stories
              <input
                type="file"
                accept="image/*"
                required
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="mt-1 block w-full text-xs text-[#17212B]/70"
              />
            </label>

            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add a caption (optional)…"
              rows={2}
              className="mt-3 w-full resize-none rounded-lg border border-[#17212B]/15 p-3 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />

            {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-[#17212B]/60 hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={posting || !file}
                className="rounded-lg bg-[#D9A72A] px-4 py-2 text-sm font-semibold text-[#17212B] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {posting ? "Posting…" : "Post story"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---- Full-screen viewer ---- */}
      {activeStory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
          {/* Progress bars */}
          <div className="absolute left-3 right-3 top-3 flex gap-1.5">
            {stories.map((_, i) => (
              <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
                <div
                  className="h-full bg-white"
                  style={{
                    width: i < viewerIndex ? "100%" : i === viewerIndex ? `${progress}%` : "0%",
                  }}
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setViewerIndex(null)}
            className="absolute right-4 top-8 text-2xl leading-none text-white/80 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>

          <p className="absolute left-4 top-8 text-sm font-medium text-white/90">
            {shortId(activeStory.author_user_id)}
          </p>

          {/* Tap zones for prev/next */}
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous story"
            className="absolute left-0 top-0 h-full w-1/3"
          />
          <button
            type="button"
            onClick={goNext}
            aria-label="Next story"
            className="absolute right-0 top-0 h-full w-1/3"
          />

          <div className="flex max-h-full max-w-full flex-col items-center justify-center px-6 text-center">
            {mediaUrlCache[activeStory.media_id] ? (
              <img
                src={mediaUrlCache[activeStory.media_id]}
                alt=""
                className="max-h-[70vh] rounded-lg object-contain"
              />
            ) : (
              <div className="flex h-48 w-48 items-center justify-center rounded-2xl bg-white/10 text-sm text-white/50">
                Photo unavailable
              </div>
            )}
            {activeStory.caption && (
              <p className="mt-4 max-w-sm text-base leading-relaxed text-white">
                {activeStory.caption}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 7H. CREATE CHURCH PAGE
// =====================================================================

/**
 * Protected page for starting a new church. Any signed-in user can create
 * one per the spec (no admin gate on POST /churches) — they land as its
 * first member and can manage it from there.
 * Route: /churches/new
 */
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * ChurchCreate requires BOTH brand_id and slug — a church can't exist
 * without belonging to a brand/network. Since there's no separate
 * "create a network" page yet, this form lets you pick an existing brand
 * or create one inline (via the real POST /brands endpoint) if none fit.
 */
function CreateChurchPage() {
  const navigate = useNavigate();

  const [brands, setBrands] = useState([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [creatingNewBrand, setCreatingNewBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGetBrands()
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setBrands(list);
        if (list.length === 0) setCreatingNewBrand(true);
        else setSelectedBrandId(list[0].id);
      })
      .catch(() => setCreatingNewBrand(true))
      .finally(() => setBrandsLoading(false));
  }, []);

  // Auto-fill the slug from the name unless the person has typed their own.
  function handleNameChange(value) {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();

    if (!trimmedName || !trimmedSlug) {
      setError("A church needs both a name and a URL slug.");
      return;
    }
    if (creatingNewBrand && !newBrandName.trim()) {
      setError("Give the network a name too.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      let brandId = selectedBrandId;
      if (creatingNewBrand) {
        const brandNameTrimmed = newBrandName.trim();
        const brand = await apiCreateBrand({
          name: brandNameTrimmed,
          slug: slugify(brandNameTrimmed),
        });
        brandId = brand.id;
      }

      const church = await apiCreateChurch({
        brand_id: brandId,
        name: trimmedName,
        slug: trimmedSlug,
        description: description.trim() || undefined,
      });
      navigate(`/churches/${church.id}/manage`, { replace: true });
    } catch (err) {
      setError(err?.message || "Couldn't create that church. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to="/churches" className="text-sm font-medium text-white/70 hover:text-white">
          ← Find a church
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">Start a church</h1>
      </header>

      <main className="mx-auto max-w-xl px-4 py-6 sm:px-6">
        <form
          onSubmit={handleSubmit}
          className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5"
        >
          {/* ---- Brand / network ---- */}
          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Network</span>
            {brandsLoading ? (
              <p className="text-sm text-[#17212B]/50">Loading networks…</p>
            ) : creatingNewBrand ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={newBrandName}
                  onChange={(e) => setNewBrandName(e.target.value)}
                  className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
                  placeholder="New network name (e.g. your denomination or ministry)"
                />
                {brands.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCreatingNewBrand(false)}
                    className="text-xs font-medium text-[#174A7E] hover:underline"
                  >
                    Use an existing network instead
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <select
                  value={selectedBrandId}
                  onChange={(e) => setSelectedBrandId(e.target.value)}
                  className="w-full rounded-lg border border-[#17212B]/15 bg-white px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
                >
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setCreatingNewBrand(true)}
                  className="text-xs font-medium text-[#174A7E] hover:underline"
                >
                  + Create a new network instead
                </button>
              </div>
            )}
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Church name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="Grace Community Church"
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">
              URL slug <span className="text-[#17212B]/40">(auto-filled, editable)</span>
            </span>
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value);
              }}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="grace-community-church"
            />
          </label>

          <label className="mb-2 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">
              Description <span className="text-[#17212B]/40">(optional)</span>
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-[#17212B]/15 p-3 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="What is your church about?"
            />
          </label>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-4 w-full rounded-lg bg-[#D9A72A] py-2.5 text-sm font-semibold text-[#17212B] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create church"}
          </button>
        </form>
      </main>
    </div>
  );
}

// =====================================================================
// 7I. MANAGE CHURCH PAGE (admin)
// =====================================================================

/**
 * Protected admin page for a single church: members (add/remove), tags
 * (create + assign/revoke), and a verify button. The spec is explicit
 * that verification is a platform-admin action, not self-service — most
 * users will get a 403 tapping it, and that's surfaced rather than hidden,
 * since there's no field on ChurchOut telling us in advance who's allowed.
 * Route: /churches/:churchId/manage
 */
function ManageChurchPage() {
  const { churchId } = useParams();

  const [church, setChurch] = useState(null);
  const [members, setMembers] = useState([]);
  const [tags, setTags] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(""); // transient success/info messages

  const [newMemberUserId, setNewMemberUserId] = useState("");
  const [addingMember, setAddingMember] = useState(false);

  const [newTagName, setNewTagName] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);

  const [assignUserId, setAssignUserId] = useState("");
  const [assignTagId, setAssignTagId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const [verifying, setVerifying] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [churchData, memberData, tagData] = await Promise.all([
        apiGetChurch(churchId),
        apiListMembers(churchId),
        apiListTags(churchId),
      ]);
      setChurch(churchData);
      setMembers(Array.isArray(memberData) ? memberData : []);
      setTags(Array.isArray(tagData) ? tagData : []);
    } catch (err) {
      setError(err?.message || "Couldn't load this church's admin data.");
    } finally {
      setLoading(false);
    }
  }, [churchId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function handleVerify() {
    setVerifying(true);
    setNotice("");
    setError("");
    try {
      const updated = await apiVerifyChurch(churchId);
      setChurch(updated);
      setNotice("Church verified.");
    } catch (err) {
      // Expect a 403 here for non-platform-admins — that's normal, not a bug.
      setError(
        err?.status === 403
          ? "Verification is a platform-admin action — your account isn't authorized to grant it."
          : err?.message || "Couldn't verify this church."
      );
    } finally {
      setVerifying(false);
    }
  }

  async function handleAddMember(e) {
    e.preventDefault();
    const trimmed = newMemberUserId.trim();
    if (!trimmed) return;

    setAddingMember(true);
    setError("");
    try {
      await apiAddMember(churchId, { user_id: trimmed });
      setNewMemberUserId("");
      const memberData = await apiListMembers(churchId);
      setMembers(Array.isArray(memberData) ? memberData : []);
      setNotice("Member added.");
    } catch (err) {
      setError(err?.message || "Couldn't add that member.");
    } finally {
      setAddingMember(false);
    }
  }

  async function handleRemoveMember(userId) {
    const previous = members;
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    try {
      await apiRemoveMember(churchId, userId);
    } catch (err) {
      setMembers(previous);
      setError(err?.message || "Couldn't remove that member.");
    }
  }

  async function handleCreateTag(e) {
    e.preventDefault();
    const trimmed = newTagName.trim();
    if (!trimmed) return;

    setCreatingTag(true);
    setError("");
    try {
      const tag = await apiCreateTag(churchId, { name: trimmed });
      setTags((prev) => [...prev, tag]);
      setNewTagName("");
    } catch (err) {
      setError(err?.message || "Couldn't create that tag.");
    } finally {
      setCreatingTag(false);
    }
  }

  async function handleAssignTag(e) {
    e.preventDefault();
    if (!assignUserId || !assignTagId) return;

    setAssigning(true);
    setError("");
    try {
      await apiAssignTag(churchId, assignUserId, { tag_id: assignTagId });
      setNotice("Tag assigned.");
    } catch (err) {
      setError(err?.message || "Couldn't assign that tag.");
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to={`/churches/${churchId}/timeline`} className="text-sm font-medium text-white/70 hover:text-white">
          ← Timeline
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">
          {church?.name ? `Manage ${church.name}` : "Manage church"}
        </h1>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:px-6">
        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading…</p>}

        {!loading && (
          <>
            {notice && (
              <p className="rounded-lg bg-[#D9A72A]/15 px-3 py-2 text-center text-sm text-[#17212B]">
                {notice}
              </p>
            )}
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-600">
                {error}
              </p>
            )}

            {/* ---- Events ---- */}
            <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#17212B]">Events</h2>
                <Link
                  to={`/churches/${churchId}/events/new`}
                  className="rounded-lg bg-[#174A7E] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                >
                  + Create event
                </Link>
              </div>
            </section>

            {/* ---- Livestreams ---- */}
            <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#17212B]">Livestreams</h2>
                <Link
                  to={`/churches/${churchId}/livestreams`}
                  className="rounded-lg bg-[#174A7E] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                >
                  Manage →
                </Link>
              </div>
            </section>

            {/* ---- Verification ---- */}
            <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-[#17212B]">Verification</h2>
                  <p className="mt-0.5 text-xs text-[#17212B]/50">
                    {church?.is_verified ? "This church is verified." : "Not yet verified."}
                  </p>
                </div>
                {!church?.is_verified && (
                  <button
                    type="button"
                    onClick={handleVerify}
                    disabled={verifying}
                    className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {verifying ? "Requesting…" : "Request verification"}
                  </button>
                )}
              </div>
            </section>

            {/* ---- Members ---- */}
            <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <h2 className="text-sm font-semibold text-[#17212B]">
                Members ({members.length})
              </h2>

              <ul className="mt-3 divide-y divide-black/5">
                {members.map((m) => (
                  <li key={m.user_id} className="flex items-center justify-between py-2.5">
                    <span className="truncate text-sm text-[#17212B]">
                      {shortId(m.user_id)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(m.user_id)}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </li>
                ))}
                {members.length === 0 && (
                  <li className="py-2.5 text-sm text-[#17212B]/50">No members yet.</li>
                )}
              </ul>

              <form onSubmit={handleAddMember} className="mt-4 flex gap-2">
                <input
                  type="text"
                  value={newMemberUserId}
                  onChange={(e) => setNewMemberUserId(e.target.value)}
                  placeholder="User ID to add"
                  className="flex-1 rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
                />
                <button
                  type="submit"
                  disabled={addingMember}
                  className="shrink-0 rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {addingMember ? "Adding…" : "Add"}
                </button>
              </form>
            </section>

            {/* ---- Tags ---- */}
            <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <h2 className="text-sm font-semibold text-[#17212B]">Tags</h2>

              <div className="mt-2 flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full bg-[#D9A72A]/15 px-3 py-1 text-xs font-medium text-[#17212B]"
                  >
                    {tag.name}
                  </span>
                ))}
                {tags.length === 0 && (
                  <span className="text-sm text-[#17212B]/50">No tags yet.</span>
                )}
              </div>

              <form onSubmit={handleCreateTag} className="mt-4 flex gap-2">
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="New tag name (e.g. Deacon)"
                  className="flex-1 rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
                />
                <button
                  type="submit"
                  disabled={creatingTag}
                  className="shrink-0 rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {creatingTag ? "Creating…" : "Create"}
                </button>
              </form>

              {tags.length > 0 && members.length > 0 && (
                <form onSubmit={handleAssignTag} className="mt-4 flex flex-wrap gap-2">
                  <select
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                    className="flex-1 rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
                  >
                    <option value="">Assign tag to…</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {shortId(m.user_id)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={assignTagId}
                    onChange={(e) => setAssignTagId(e.target.value)}
                    className="flex-1 rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
                  >
                    <option value="">Which tag…</option>
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={assigning || !assignUserId || !assignTagId}
                    className="shrink-0 rounded-lg bg-[#D9A72A] px-4 py-2 text-sm font-semibold text-[#17212B] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {assigning ? "Assigning…" : "Assign"}
                  </button>
                </form>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

// =====================================================================
// 7J. PRAYER WALL PAGE
// =====================================================================

const PRAYER_PAGE_SIZE = 20;

/**
 * Global prayer wall — a real, live feature (POST/GET /prayer-wall, POST
 * .../support). Route: /prayer-wall
 *
 * KNOWN GAP: there's no GET endpoint anywhere to list who supported a
 * request or how many times, so — like post likes before the count/me
 * split, except worse — there's no way to show a real support count at
 * all here. The "🙏 Praying" button posts a real support record each tap,
 * but the UI only tracks "did I tap this in THIS session" locally; it
 * can't know if you (or anyone else) supported it in a past session.
 */
function PrayerWallPage() {
  const { user } = useAuth();

  const [requests, setRequests] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [testimoniesOnly, setTestimoniesOnly] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const [supportedIds, setSupportedIds] = useState(() => new Set());
  const [supportingId, setSupportingId] = useState(null);

  // Composer state
  const [showForm, setShowForm] = useState(false);
  const [body, setBody] = useState("");
  const [isTestimony, setIsTestimony] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [myChurches, setMyChurches] = useState([]); // [{ id, name }]
  const [churchId, setChurchId] = useState(""); // "" = not tied to a church
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const loadPage = useCallback(
    async (targetOffset, { append, testimonies }) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError("");
      }
      try {
        const data = await apiListPrayerWall({
          testimonies_only: testimonies,
          limit: PRAYER_PAGE_SIZE,
          offset: targetOffset,
        });
        const page = Array.isArray(data) ? data : [];
        setRequests((prev) => (append ? [...prev, ...page] : page));
        setOffset(targetOffset + page.length);
        setHasMore(page.length === PRAYER_PAGE_SIZE);
      } catch (err) {
        setError(err?.message || "Couldn't load the prayer wall.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  useEffect(() => {
    loadPage(0, { append: false, testimonies: testimoniesOnly });
  }, [testimoniesOnly, loadPage]);

  // For the optional "post to my church" dropdown — same membership
  // pattern used on FeedPage, since church_id isn't required here.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    apiGetUserChurchHistory(user.id)
      .then(async (history) => {
        const activeIds = (Array.isArray(history) ? history : [])
          .filter((m) => !m.left_at && m.status !== "removed")
          .map((m) => m.church_id);
        const churches = await Promise.all(
          activeIds.map((id) =>
            apiGetChurch(id)
              .then((c) => ({ id, name: c?.name || id }))
              .catch(() => ({ id, name: id }))
          )
        );
        if (!cancelled) setMyChurches(churches);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  async function handleSupport(requestId) {
    if (supportingId) return;
    setSupportingId(requestId);
    try {
      await apiSupportPrayerRequest(requestId, { type: "praying" });
      setSupportedIds((prev) => new Set(prev).add(requestId));
    } catch (err) {
      setError(err?.message || "Couldn't record that right now.");
    } finally {
      setSupportingId(null);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setFormError("");
    try {
      const newRequest = await apiPostPrayerRequest({
        body: trimmed,
        church_id: churchId || undefined,
        is_testimony: isTestimony,
        is_anonymous: isAnonymous,
      });
      setRequests((prev) => [newRequest, ...prev]);
      setBody("");
      setIsTestimony(false);
      setIsAnonymous(false);
      setShowForm(false);
    } catch (err) {
      setFormError(err?.message || "Couldn't post that. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to="/feed" className="text-sm font-medium text-white/70 hover:text-white">
          ← Back to feed
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">Prayer Wall</h1>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:px-6">
        {/* ---- Filter tabs ---- */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTestimoniesOnly(false)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              !testimoniesOnly ? "bg-[#174A7E] text-white" : "bg-white text-[#17212B]/60 ring-1 ring-black/5"
            }`}
          >
            All requests
          </button>
          <button
            type="button"
            onClick={() => setTestimoniesOnly(true)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              testimoniesOnly ? "bg-[#174A7E] text-white" : "bg-white text-[#17212B]/60 ring-1 ring-black/5"
            }`}
          >
            Testimonies
          </button>
        </div>

        {/* ---- Composer toggle ---- */}
        {!showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-xl bg-white p-4 text-left text-sm text-[#17212B]/50 shadow-sm ring-1 ring-black/5 hover:text-[#17212B]/70"
          >
            Share a prayer request or testimony…
          </button>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5"
          >
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What's on your heart?"
              rows={3}
              autoFocus
              className="w-full resize-none rounded-lg border border-[#17212B]/15 p-3 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />

            <div className="mt-3 flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-[#17212B]/70">
                <input
                  type="checkbox"
                  checked={isTestimony}
                  onChange={(e) => setIsTestimony(e.target.checked)}
                  className="h-4 w-4 rounded border-[#17212B]/30 text-[#174A7E]"
                />
                This is a testimony
              </label>
              <label className="flex items-center gap-2 text-sm text-[#17212B]/70">
                <input
                  type="checkbox"
                  checked={isAnonymous}
                  onChange={(e) => setIsAnonymous(e.target.checked)}
                  className="h-4 w-4 rounded border-[#17212B]/30 text-[#174A7E]"
                />
                Post anonymously
              </label>
            </div>

            {myChurches.length > 0 && (
              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[#17212B]/50">
                  Share with (optional)
                </span>
                <select
                  value={churchId}
                  onChange={(e) => setChurchId(e.target.value)}
                  className="w-full rounded-lg border border-[#17212B]/15 bg-white px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
                >
                  <option value="">Everyone (public)</option>
                  {myChurches.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-[#17212B]/60 hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !body.trim()}
                className="rounded-lg bg-[#D9A72A] px-4 py-2 text-sm font-semibold text-[#17212B] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Posting…" : "Post"}
              </button>
            </div>
          </form>
        )}

        {/* ---- Feed ---- */}
        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading…</p>}

        {!loading && error && (
          <div className="rounded-lg bg-white p-4 text-center ring-1 ring-black/5">
            <p className="mb-3 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => loadPage(0, { append: false, testimonies: testimoniesOnly })}
              className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && requests.length === 0 && (
          <div className="rounded-lg bg-white p-8 text-center ring-1 ring-black/5">
            <p className="text-sm text-[#17212B]/60">
              {testimoniesOnly ? "No testimonies yet." : "No prayer requests yet."}
            </p>
          </div>
        )}

        {!loading &&
          !error &&
          requests.map((req) => {
            const supported = supportedIds.has(req.id);
            return (
              <article
                key={req.id}
                className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5"
              >
                <header className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-[#17212B]">
                    {req.is_anonymous ? "Anonymous" : shortId(req.author_user_id)}
                  </span>
                  <div className="flex items-center gap-2">
                    {req.is_testimony && (
                      <span className="rounded-full bg-[#D9A72A]/20 px-2 py-0.5 text-[10px] font-semibold text-[#17212B]">
                        Testimony
                      </span>
                    )}
                    {req.created_at && (
                      <time className="text-xs text-[#17212B]/50">
                        {new Date(req.created_at).toLocaleDateString()}
                      </time>
                    )}
                  </div>
                </header>

                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#17212B]">
                  {req.body}
                </p>

                <footer className="mt-3">
                  <button
                    type="button"
                    onClick={() => handleSupport(req.id)}
                    disabled={supported || supportingId === req.id}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                      supported
                        ? "bg-[#D9A72A] text-[#17212B]"
                        : "bg-[#174A7E] text-white hover:opacity-90 disabled:opacity-70"
                    }`}
                  >
                    🙏 {supported ? "Praying" : "I'm praying"}
                  </button>
                </footer>
              </article>
            );
          })}

        {!loading && !error && hasMore && requests.length > 0 && (
          <button
            type="button"
            onClick={() => loadPage(offset, { append: true, testimonies: testimoniesOnly })}
            disabled={loadingMore}
            className="mx-auto rounded-lg border border-[#174A7E]/20 bg-white px-4 py-2 text-sm font-medium text-[#174A7E] hover:bg-[#174A7E]/5 disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </main>
    </div>
  );
}

// =====================================================================
// 7K. DISCUSSIONS — LIST PAGE
// =====================================================================

const THREADS_PAGE_SIZE = 30;

/**
 * Real forum-style discussion threads (this is the closest thing to
 * "comments" the API actually has — separate from posts, see the earlier
 * note on /posts/{id}/interactions only logging a signal, not text).
 * Route: /discussions
 */
function DiscussionsPage() {
  const [threads, setThreads] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const loadPage = useCallback(async (targetOffset, { append }) => {
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError("");
    }
    try {
      const data = await apiListThreads({ limit: THREADS_PAGE_SIZE, offset: targetOffset });
      const page = Array.isArray(data) ? data : [];
      setThreads((prev) => (append ? [...prev, ...page] : page));
      setOffset(targetOffset + page.length);
      setHasMore(page.length === THREADS_PAGE_SIZE);
    } catch (err) {
      setError(err?.message || "Couldn't load discussions.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    loadPage(0, { append: false });
  }, [loadPage]);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setSubmitting(true);
    setFormError("");
    try {
      const newThread = await apiCreateThread({
        title: trimmedTitle,
        body: body.trim() || undefined,
      });
      setThreads((prev) => [newThread, ...prev]);
      setTitle("");
      setBody("");
      setShowForm(false);
    } catch (err) {
      setFormError(err?.message || "Couldn't start that discussion.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to="/feed" className="text-sm font-medium text-white/70 hover:text-white">
          ← Back to feed
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">Discussions</h1>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:px-6">
        {!showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-xl bg-white p-4 text-left text-sm text-[#17212B]/50 shadow-sm ring-1 ring-black/5 hover:text-[#17212B]/70"
          >
            + Start a discussion
          </button>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5"
          >
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What do you want to discuss?"
              autoFocus
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add more detail (optional)…"
              rows={3}
              className="mt-3 w-full resize-none rounded-lg border border-[#17212B]/15 p-3 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />

            {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-[#17212B]/60 hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !title.trim()}
                className="rounded-lg bg-[#D9A72A] px-4 py-2 text-sm font-semibold text-[#17212B] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Posting…" : "Start discussion"}
              </button>
            </div>
          </form>
        )}

        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading…</p>}

        {!loading && error && (
          <div className="rounded-lg bg-white p-4 text-center ring-1 ring-black/5">
            <p className="mb-3 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => loadPage(0, { append: false })}
              className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && threads.length === 0 && (
          <div className="rounded-lg bg-white p-8 text-center ring-1 ring-black/5">
            <p className="text-sm text-[#17212B]/60">No discussions yet — start one.</p>
          </div>
        )}

        {!loading &&
          !error &&
          threads.map((thread) => (
            <Link
              key={thread.id}
              to={`/discussions/${thread.id}`}
              className="block rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5 hover:ring-[#174A7E]/20"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="truncate text-sm font-semibold text-[#17212B]">{thread.title}</h2>
                {thread.source_topic && (
                  <span className="shrink-0 rounded-full bg-[#D9A72A]/15 px-2 py-0.5 text-[10px] font-medium text-[#17212B]">
                    {thread.source_topic}
                  </span>
                )}
              </div>
              {thread.body && (
                <p className="mt-1 line-clamp-2 text-xs text-[#17212B]/55">{thread.body}</p>
              )}
              <p className="mt-2 text-xs text-[#17212B]/40">
                {shortId(thread.created_by_user_id)}
                {thread.created_at && ` · ${new Date(thread.created_at).toLocaleDateString()}`}
              </p>
            </Link>
          ))}

        {!loading && !error && hasMore && threads.length > 0 && (
          <button
            type="button"
            onClick={() => loadPage(offset, { append: true })}
            disabled={loadingMore}
            className="mx-auto rounded-lg border border-[#174A7E]/20 bg-white px-4 py-2 text-sm font-medium text-[#174A7E] hover:bg-[#174A7E]/5 disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </main>
    </div>
  );
}

// =====================================================================
// 7L. DISCUSSIONS — THREAD DETAIL PAGE
// =====================================================================

/**
 * A single thread's replies. GET .../replies has no documented pagination,
 * so this loads the full flat list — fine for typical thread sizes, but
 * worth knowing if a thread ever gets huge.
 * Route: /discussions/:threadId
 */
function ThreadPage() {
  const { threadId } = useParams();

  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  const loadReplies = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiListReplies(threadId);
      setReplies(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Couldn't load replies.");
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    loadReplies();
  }, [loadReplies]);

  async function handleReply(e) {
    e.preventDefault();
    const trimmed = replyBody.trim();
    if (!trimmed) return;

    setSending(true);
    setSendError("");
    try {
      const newReply = await apiReplyToThread(threadId, { body: trimmed });
      setReplies((prev) => [...prev, newReply]);
      setReplyBody("");
    } catch (err) {
      setSendError(err?.message || "Couldn't send that reply.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to="/discussions" className="text-sm font-medium text-white/70 hover:text-white">
          ← Discussions
        </Link>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-6 sm:px-6">
        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading…</p>}

        {!loading && error && (
          <div className="rounded-lg bg-white p-4 text-center ring-1 ring-black/5">
            <p className="mb-3 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={loadReplies}
              className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && replies.length === 0 && (
          <p className="py-6 text-center text-sm text-[#17212B]/60">
            No replies yet — be the first.
          </p>
        )}

        {!loading &&
          !error &&
          replies.map((reply) => (
            <div key={reply.id} className="rounded-xl bg-white p-3.5 shadow-sm ring-1 ring-black/5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-[#17212B]/70">
                  {shortId(reply.author_user_id)}
                </span>
                {reply.created_at && (
                  <time className="text-[10px] text-[#17212B]/40">
                    {new Date(reply.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                )}
              </div>
              {reply.parent_reply_id && (
                <p className="mb-1 text-[10px] text-[#17212B]/40">↳ in reply to another message</p>
              )}
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#17212B]">
                {reply.body}
              </p>
            </div>
          ))}

        <form onSubmit={handleReply} className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Write a reply…"
            className="flex-1 rounded-full border border-[#17212B]/15 bg-white px-4 py-2.5 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
          />
          <button
            type="submit"
            disabled={sending || !replyBody.trim()}
            className="shrink-0 rounded-full bg-[#D9A72A] px-5 py-2.5 text-sm font-semibold text-[#17212B] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? "…" : "Reply"}
          </button>
        </form>
        {sendError && <p className="text-center text-xs text-red-600">{sendError}</p>}
      </main>
    </div>
  );
}

// =====================================================================
// 7M. EVENTS — DISCOVER PAGE
// =====================================================================

const EVENTS_PAGE_SIZE = 30;

/**
 * Global, cross-church event browse. Both this and the event detail page
 * are genuinely public per the spec (no auth in their security config),
 * so this works even signed out — but it's kept behind the app's normal
 * ProtectedRoute here for consistency with the rest of the nav.
 *
 * NO RSVP: there is no attend/RSVP endpoint anywhere in the spec — no
 * POST .../attend, no attendee list, nothing. So this page shows event
 * details only; it doesn't invent an RSVP button that has nowhere to
 * send its data.
 * Route: /events
 */
function EventsDiscoverPage() {
  const [events, setEvents] = useState([]);
  const [eventType, setEventType] = useState("");
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const loadPage = useCallback(
    async (targetOffset, { append, type, upcoming }) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError("");
      }
      try {
        const data = await apiDiscoverEvents({
          event_type: type || undefined,
          upcoming_only: upcoming,
          limit: EVENTS_PAGE_SIZE,
          offset: targetOffset,
        });
        const page = Array.isArray(data) ? data : [];
        setEvents((prev) => (append ? [...prev, ...page] : page));
        setOffset(targetOffset + page.length);
        setHasMore(page.length === EVENTS_PAGE_SIZE);
      } catch (err) {
        setError(err?.message || "Couldn't load events.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  useEffect(() => {
    loadPage(0, { append: false, type: eventType, upcoming: upcomingOnly });
  }, [eventType, upcomingOnly, loadPage]);

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to="/feed" className="text-sm font-medium text-white/70 hover:text-white">
          ← Back to feed
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">Discover Events</h1>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            placeholder="Filter by type (e.g. worship, conference)"
            className="flex-1 rounded-lg border border-[#17212B]/15 bg-white px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
          />
          <label className="flex items-center gap-2 whitespace-nowrap text-sm text-[#17212B]/70">
            <input
              type="checkbox"
              checked={upcomingOnly}
              onChange={(e) => setUpcomingOnly(e.target.checked)}
              className="h-4 w-4 rounded border-[#17212B]/30 text-[#174A7E]"
            />
            Upcoming only
          </label>
        </div>

        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading…</p>}

        {!loading && error && (
          <div className="rounded-lg bg-white p-4 text-center ring-1 ring-black/5">
            <p className="mb-3 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => loadPage(0, { append: false, type: eventType, upcoming: upcomingOnly })}
              className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <div className="rounded-lg bg-white p-8 text-center ring-1 ring-black/5">
            <p className="text-sm text-[#17212B]/60">No events found for this filter.</p>
          </div>
        )}

        {!loading &&
          !error &&
          events.map((event) => (
            <Link
              key={event.id}
              to={`/events/${event.id}`}
              className="block rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5 hover:ring-[#174A7E]/20"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="truncate text-sm font-semibold text-[#17212B]">{event.title}</h2>
                <span className="shrink-0 rounded-full bg-[#D9A72A]/15 px-2 py-0.5 text-[10px] font-medium text-[#17212B]">
                  {event.event_type}
                </span>
              </div>
              {event.start_time && (
                <p className="mt-1 text-xs text-[#174A7E]">
                  {new Date(event.start_time).toLocaleString([], {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              )}
              {event.description && (
                <p className="mt-1 line-clamp-2 text-xs text-[#17212B]/55">{event.description}</p>
              )}
            </Link>
          ))}

        {!loading && !error && hasMore && events.length > 0 && (
          <button
            type="button"
            onClick={() => loadPage(offset, { append: true, type: eventType, upcoming: upcomingOnly })}
            disabled={loadingMore}
            className="mx-auto rounded-lg border border-[#174A7E]/20 bg-white px-4 py-2 text-sm font-medium text-[#174A7E] hover:bg-[#174A7E]/5 disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </main>
    </div>
  );
}

// =====================================================================
// 7N. EVENT DETAIL PAGE
// =====================================================================

/** Route: /events/:eventId */
function EventDetailPage() {
  const { eventId } = useParams();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    apiGetEvent(eventId)
      .then(setEvent)
      .catch((err) => setError(err?.message || "Couldn't load this event."))
      .finally(() => setLoading(false));
  }, [eventId]);

  const isUrl = event?.location_or_link?.startsWith("http");

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to="/events" className="text-sm font-medium text-white/70 hover:text-white">
          ← Discover Events
        </Link>
      </header>

      <main className="mx-auto max-w-xl px-4 py-6 sm:px-6">
        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading…</p>}

        {!loading && error && (
          <p className="rounded-lg bg-white p-4 text-center text-sm text-red-600 ring-1 ring-black/5">
            {error}
          </p>
        )}

        {!loading && event && (
          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <span className="inline-block rounded-full bg-[#D9A72A]/15 px-2.5 py-1 text-xs font-medium text-[#17212B]">
              {event.event_type}
            </span>
            <h1 className="mt-3 text-xl font-semibold text-[#17212B]">{event.title}</h1>

            {event.start_time && (
              <p className="mt-2 text-sm font-medium text-[#174A7E]">
                {new Date(event.start_time).toLocaleString([], {
                  dateStyle: "full",
                  timeStyle: "short",
                })}
                {event.end_time &&
                  ` – ${new Date(event.end_time).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`}
              </p>
            )}

            {event.location_or_link &&
              (isUrl ? (
                <a
                  href={event.location_or_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-sm text-[#174A7E] hover:underline"
                >
                  {event.location_or_link}
                </a>
              ) : (
                <p className="mt-1 text-sm text-[#17212B]/70">{event.location_or_link}</p>
              ))}

            {event.description && (
              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-[#17212B]">
                {event.description}
              </p>
            )}

            <Link
              to={`/churches/${event.church_id}/timeline`}
              className="mt-5 inline-block text-sm font-medium text-[#174A7E] hover:underline"
            >
              View organizing church →
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

// =====================================================================
// 7O. CREATE EVENT PAGE
// =====================================================================

/**
 * Church-scoped event creation. Route: /churches/:churchId/events/new
 * No speaker picker here — SpeakerCreate/search is a separate real feature
 * but out of scope for this pass; speaker_ids is left empty.
 */
function CreateEventPage() {
  const { churchId } = useParams();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [locationOrLink, setLocationOrLink] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedType = eventType.trim();

    if (!trimmedTitle || !trimmedType || !startTime) {
      setError("Title, event type, and start time are all required.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const event = await apiCreateEvent(churchId, {
        title: trimmedTitle,
        event_type: trimmedType,
        start_time: new Date(startTime).toISOString(),
        end_time: endTime ? new Date(endTime).toISOString() : undefined,
        location_or_link: locationOrLink.trim() || undefined,
        description: description.trim() || undefined,
      });
      navigate(`/events/${event.id}`, { replace: true });
    } catch (err) {
      setError(err?.message || "Couldn't create that event.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to={`/churches/${churchId}/manage`} className="text-sm font-medium text-white/70 hover:text-white">
          ← Manage church
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">Create event</h1>
      </header>

      <main className="mx-auto max-w-xl px-4 py-6 sm:px-6">
        <form onSubmit={handleSubmit} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="Sunday Worship Night"
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Event type</span>
            <input
              type="text"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="worship, conference, retreat…"
            />
          </label>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-[#17212B]">Start</span>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-[#17212B]">
                End <span className="text-[#17212B]/40">(optional)</span>
              </span>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              />
            </label>
          </div>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">
              Location or link <span className="text-[#17212B]/40">(optional)</span>
            </span>
            <input
              type="text"
              value={locationOrLink}
              onChange={(e) => setLocationOrLink(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="123 Main St, or https://…"
            />
          </label>

          <label className="mb-2 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">
              Description <span className="text-[#17212B]/40">(optional)</span>
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-[#17212B]/15 p-3 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />
          </label>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-4 w-full rounded-lg bg-[#D9A72A] py-2.5 text-sm font-semibold text-[#17212B] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create event"}
          </button>
        </form>
      </main>
    </div>
  );
}

// =====================================================================
// 7P. SPEAKERS PAGE
// =====================================================================

/**
 * Search, add, and (attempt to) verify speakers. Route: /speakers
 * GET /speakers has no pagination params in the spec — it returns
 * whatever matches the topic/church filters in one shot.
 */
function SpeakersPage() {
  const [speakers, setSpeakers] = useState([]);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [topicsCsv, setTopicsCsv] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [verifyingId, setVerifyingId] = useState(null);

  const search = useCallback(async (topicFilter) => {
    setLoading(true);
    setError("");
    try {
      const data = await apiSearchSpeakers({ topic: topicFilter || undefined });
      setSpeakers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Couldn't load speakers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    search(topic);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setSubmitting(true);
    setFormError("");
    try {
      const speaker = await apiCreateSpeaker({
        name: trimmedName,
        bio: bio.trim() || undefined,
        topics_csv: topicsCsv.trim() || undefined,
        contact_info: contactInfo.trim() || undefined,
      });
      setSpeakers((prev) => [speaker, ...prev]);
      setName("");
      setBio("");
      setTopicsCsv("");
      setContactInfo("");
      setShowForm(false);
    } catch (err) {
      setFormError(err?.message || "Couldn't add that speaker.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(speakerId) {
    setVerifyingId(speakerId);
    setError("");
    try {
      const updated = await apiVerifySpeaker(speakerId);
      setSpeakers((prev) => prev.map((s) => (s.id === speakerId ? updated : s)));
    } catch (err) {
      setError(
        err?.status === 403
          ? "Verifying a speaker isn't authorized for your account."
          : err?.message || "Couldn't verify that speaker."
      );
    } finally {
      setVerifyingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to="/feed" className="text-sm font-medium text-white/70 hover:text-white">
          ← Back to feed
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">Speakers</h1>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search(topic)}
            placeholder="Search by topic (e.g. marriage, youth)"
            className="flex-1 rounded-lg border border-[#17212B]/15 bg-white px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
          />
          <button
            type="button"
            onClick={() => search(topic)}
            className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Search
          </button>
        </div>

        {!showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-xl bg-white p-4 text-left text-sm text-[#17212B]/50 shadow-sm ring-1 ring-black/5 hover:text-[#17212B]/70"
          >
            + Add a speaker
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Speaker name"
              autoFocus
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Short bio (optional)"
              rows={2}
              className="mt-3 w-full resize-none rounded-lg border border-[#17212B]/15 p-3 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />
            <input
              type="text"
              value={topicsCsv}
              onChange={(e) => setTopicsCsv(e.target.value)}
              placeholder="Topics, comma separated (optional)"
              className="mt-3 w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />
            <input
              type="text"
              value={contactInfo}
              onChange={(e) => setContactInfo(e.target.value)}
              placeholder="Contact info (optional)"
              className="mt-3 w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />

            {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-[#17212B]/60 hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !name.trim()}
                className="rounded-lg bg-[#D9A72A] px-4 py-2 text-sm font-semibold text-[#17212B] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Adding…" : "Add speaker"}
              </button>
            </div>
          </form>
        )}

        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading…</p>}

        {!loading && error && <p className="text-center text-sm text-red-600">{error}</p>}

        {!loading && !error && speakers.length === 0 && (
          <div className="rounded-lg bg-white p-8 text-center ring-1 ring-black/5">
            <p className="text-sm text-[#17212B]/60">No speakers found.</p>
          </div>
        )}

        {!loading &&
          !error &&
          speakers.map((speaker) => (
            <div key={speaker.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-[#17212B]">{speaker.name}</h2>
                  {speaker.is_verified && (
                    <span className="rounded-full bg-[#D9A72A]/20 px-2 py-0.5 text-[10px] font-semibold text-[#17212B]">
                      Verified
                    </span>
                  )}
                </div>
                {!speaker.is_verified && (
                  <button
                    type="button"
                    onClick={() => handleVerify(speaker.id)}
                    disabled={verifyingId === speaker.id}
                    className="text-xs font-medium text-[#174A7E] hover:underline disabled:opacity-60"
                  >
                    {verifyingId === speaker.id ? "Verifying…" : "Verify"}
                  </button>
                )}
              </div>
              {speaker.bio && (
                <p className="mt-1.5 text-xs leading-relaxed text-[#17212B]/60">{speaker.bio}</p>
              )}
            </div>
          ))}
      </main>
    </div>
  );
}

// =====================================================================
// 7Q. GROUPS PAGE
// =====================================================================

/**
 * Create, browse, and join groups. Route: /groups
 *
 * KNOWN GAP: there's no GET endpoint to list a group's members or check
 * whether you've already joined one — same shape of limitation as the
 * prayer wall's support taps. So "Joined" here only means "you tapped
 * Join in this session," not a real membership status pulled from the
 * server (there's nothing to pull it from).
 */
function GroupsPage() {
  const [groups, setGroups] = useState([]);
  const [groupType, setGroupType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [joinedIds, setJoinedIds] = useState(() => new Set());
  const [joiningId, setJoiningId] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [newGroupType, setNewGroupType] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const loadGroups = useCallback(async (typeFilter) => {
    setLoading(true);
    setError("");
    try {
      const data = await apiListGroups({ group_type: typeFilter || undefined });
      setGroups(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Couldn't load groups.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups(groupType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedType = newGroupType.trim();
    if (!trimmedName || !trimmedType) {
      setFormError("A group needs a name and a type.");
      return;
    }

    setSubmitting(true);
    setFormError("");
    try {
      const group = await apiCreateGroup({
        name: trimmedName,
        group_type: trimmedType,
        description: description.trim() || undefined,
        is_private: isPrivate,
      });
      setGroups((prev) => [group, ...prev]);
      setName("");
      setNewGroupType("");
      setDescription("");
      setIsPrivate(false);
      setShowForm(false);
    } catch (err) {
      setFormError(err?.message || "Couldn't create that group.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleJoin(groupId) {
    if (joiningId) return;
    setJoiningId(groupId);
    try {
      await apiJoinGroup(groupId);
      setJoinedIds((prev) => new Set(prev).add(groupId));
    } catch (err) {
      setError(err?.message || "Couldn't join that group.");
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to="/feed" className="text-sm font-medium text-white/70 hover:text-white">
          ← Back to feed
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">Groups</h1>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={groupType}
            onChange={(e) => setGroupType(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadGroups(groupType)}
            placeholder="Filter by type (e.g. bible-study, youth)"
            className="flex-1 rounded-lg border border-[#17212B]/15 bg-white px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
          />
          <button
            type="button"
            onClick={() => loadGroups(groupType)}
            className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Filter
          </button>
        </div>

        {!showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-xl bg-white p-4 text-left text-sm text-[#17212B]/50 shadow-sm ring-1 ring-black/5 hover:text-[#17212B]/70"
          >
            + Create a group
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name"
              autoFocus
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />
            <input
              type="text"
              value={newGroupType}
              onChange={(e) => setNewGroupType(e.target.value)}
              placeholder="Group type (e.g. bible-study, youth)"
              className="mt-3 w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this group about? (optional)"
              rows={2}
              className="mt-3 w-full resize-none rounded-lg border border-[#17212B]/15 p-3 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />
            <label className="mt-3 flex items-center gap-2 text-sm text-[#17212B]/70">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="h-4 w-4 rounded border-[#17212B]/30 text-[#174A7E]"
              />
              Private group
            </label>

            {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-[#17212B]/60 hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !name.trim() || !newGroupType.trim()}
                className="rounded-lg bg-[#D9A72A] px-4 py-2 text-sm font-semibold text-[#17212B] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Creating…" : "Create group"}
              </button>
            </div>
          </form>
        )}

        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading…</p>}

        {!loading && error && <p className="text-center text-sm text-red-600">{error}</p>}

        {!loading && !error && groups.length === 0 && (
          <div className="rounded-lg bg-white p-8 text-center ring-1 ring-black/5">
            <p className="text-sm text-[#17212B]/60">No groups found.</p>
          </div>
        )}

        {!loading &&
          !error &&
          groups.map((group) => {
            const joined = joinedIds.has(group.id);
            return (
              <div key={group.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-[#17212B]">{group.name}</h2>
                      <span className="rounded-full bg-[#D9A72A]/15 px-2 py-0.5 text-[10px] font-medium text-[#17212B]">
                        {group.group_type}
                      </span>
                      {group.is_private && (
                        <span className="rounded-full bg-[#17212B]/10 px-2 py-0.5 text-[10px] font-medium text-[#17212B]/60">
                          Private
                        </span>
                      )}
                    </div>
                    {group.description && (
                      <p className="mt-1 text-xs text-[#17212B]/55">{group.description}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleJoin(group.id)}
                    disabled={joined || joiningId === group.id}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed ${
                      joined
                        ? "bg-[#D9A72A]/20 text-[#17212B]"
                        : "bg-[#174A7E] text-white hover:opacity-90 disabled:opacity-60"
                    }`}
                  >
                    {joined ? "Joined" : joiningId === group.id ? "Joining…" : "Join"}
                  </button>
                </div>
              </div>
            );
          })}
      </main>
    </div>
  );
}

// =====================================================================
// 7R. LIVE NOW PAGE (platform-wide)
// =====================================================================

/**
 * Everything live right now, across every church. Public per the spec,
 * but kept behind the app's normal ProtectedRoute for nav consistency.
 * The actual video player lives at GET /watch/{public_slug} — that's a
 * server-rendered HTML page (uses hls.js), not JSON, so this links out to
 * it directly rather than trying to embed/fetch it through the API client.
 * Route: /live
 */
function LiveNowPage() {
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiListLiveNow();
      setStreams(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Couldn't load live streams.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to="/feed" className="text-sm font-medium text-white/70 hover:text-white">
          ← Back to feed
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">Live Now</h1>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:px-6">
        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading…</p>}

        {!loading && error && (
          <div className="rounded-lg bg-white p-4 text-center ring-1 ring-black/5">
            <p className="mb-3 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={load}
              className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && streams.length === 0 && (
          <div className="rounded-lg bg-white p-8 text-center ring-1 ring-black/5">
            <p className="text-sm text-[#17212B]/60">Nothing is live right now.</p>
          </div>
        )}

        {!loading &&
          !error &&
          streams.map((stream) => (
            <div key={stream.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="truncate text-sm font-semibold text-[#17212B]">{stream.title}</h2>
                <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                  ● LIVE
                </span>
              </div>
              {stream.description && (
                <p className="mt-1 line-clamp-2 text-xs text-[#17212B]/55">{stream.description}</p>
              )}
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-[#17212B]/40">{stream.view_count} watching</span>
                <a
                  href={`${BASE_URL}/watch/${stream.public_slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-[#174A7E] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                >
                  Watch →
                </a>
              </div>
            </div>
          ))}
      </main>
    </div>
  );
}

// =====================================================================
// 7S. CHURCH LIVESTREAMS PAGE (manage + broadcast)
// =====================================================================

/**
 * A church's livestream list, plus the full broadcaster flow: create a
 * stream, reveal its ingest credentials, go live, end it.
 * Route: /churches/:churchId/livestreams
 *
 * SECURITY NOTE: the ingest response (rtmp_url + stream_key) is a genuine
 * secret — anyone with it can broadcast AS this church. It's fetched only
 * on an explicit "Show streaming details" tap (never auto-loaded with the
 * list), shown with an unmistakable warning, and never persisted anywhere
 * client-side beyond component state.
 */
function ChurchLivestreamsPage() {
  const { churchId } = useParams();

  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledStart, setScheduledStart] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [ingestByStream, setIngestByStream] = useState({}); // streamId -> ingest data
  const [ingestLoadingId, setIngestLoadingId] = useState(null);
  const [actionId, setActionId] = useState(null); // stream mid go-live/end

  const loadStreams = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiListChurchLivestreams(churchId);
      setStreams(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Couldn't load livestreams.");
    } finally {
      setLoading(false);
    }
  }, [churchId]);

  useEffect(() => {
    loadStreams();
  }, [loadStreams]);

  async function handleCreate(e) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setSubmitting(true);
    setFormError("");
    try {
      const stream = await apiCreateLivestream(churchId, {
        title: trimmedTitle,
        description: description.trim() || undefined,
        scheduled_start_time: scheduledStart ? new Date(scheduledStart).toISOString() : undefined,
      });
      setStreams((prev) => [stream, ...prev]);
      setTitle("");
      setDescription("");
      setScheduledStart("");
      setShowForm(false);
    } catch (err) {
      setFormError(err?.message || "Couldn't create that livestream.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleShowIngest(streamId) {
    if (ingestByStream[streamId]) {
      // Toggle closed if already revealed.
      setIngestByStream((prev) => {
        const next = { ...prev };
        delete next[streamId];
        return next;
      });
      return;
    }
    setIngestLoadingId(streamId);
    setError("");
    try {
      const ingest = await apiGetLivestreamIngest(streamId);
      setIngestByStream((prev) => ({ ...prev, [streamId]: ingest }));
    } catch (err) {
      setError(err?.message || "Couldn't load streaming details.");
    } finally {
      setIngestLoadingId(null);
    }
  }

  async function handleGoLive(streamId) {
    setActionId(streamId);
    setError("");
    try {
      const updated = await apiGoLive(streamId);
      setStreams((prev) => prev.map((s) => (s.id === streamId ? updated : s)));
    } catch (err) {
      setError(err?.message || "Couldn't go live.");
    } finally {
      setActionId(null);
    }
  }

  async function handleEnd(streamId) {
    setActionId(streamId);
    setError("");
    try {
      const updated = await apiEndLivestream(streamId);
      setStreams((prev) => prev.map((s) => (s.id === streamId ? updated : s)));
    } catch (err) {
      setError(err?.message || "Couldn't end the stream.");
    } finally {
      setActionId(null);
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to={`/churches/${churchId}/manage`} className="text-sm font-medium text-white/70 hover:text-white">
          ← Manage church
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">Livestreams</h1>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:px-6">
        {error && <p className="text-center text-sm text-red-600">{error}</p>}

        {!showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-xl bg-white p-4 text-left text-sm text-[#17212B]/50 shadow-sm ring-1 ring-black/5 hover:text-[#17212B]/70"
          >
            + Schedule a livestream
          </button>
        ) : (
          <form onSubmit={handleCreate} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Stream title"
              autoFocus
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="mt-3 w-full resize-none rounded-lg border border-[#17212B]/15 p-3 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[#17212B]/50">
                Scheduled start (optional)
              </span>
              <input
                type="datetime-local"
                value={scheduledStart}
                onChange={(e) => setScheduledStart(e.target.value)}
                className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              />
            </label>

            {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-[#17212B]/60 hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !title.trim()}
                className="rounded-lg bg-[#D9A72A] px-4 py-2 text-sm font-semibold text-[#17212B] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        )}

        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading…</p>}

        {!loading && streams.length === 0 && (
          <div className="rounded-lg bg-white p-8 text-center ring-1 ring-black/5">
            <p className="text-sm text-[#17212B]/60">No livestreams yet.</p>
          </div>
        )}

        {!loading &&
          streams.map((stream) => {
            const ingest = ingestByStream[stream.id];
            const isLive = stream.status === "live";
            return (
              <div key={stream.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="truncate text-sm font-semibold text-[#17212B]">{stream.title}</h2>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      isLive ? "bg-red-100 text-red-600" : "bg-[#17212B]/10 text-[#17212B]/60"
                    }`}
                  >
                    {isLive ? "● LIVE" : stream.status}
                  </span>
                </div>
                {stream.description && (
                  <p className="mt-1 text-xs text-[#17212B]/55">{stream.description}</p>
                )}
                <p className="mt-1 text-xs text-[#17212B]/40">{stream.view_count} views</p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {isLive && (
                    <a
                      href={`${BASE_URL}/watch/${stream.public_slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg bg-[#174A7E] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                    >
                      Watch page →
                    </a>
                  )}
                  {!isLive && stream.status !== "ended" && (
                    <button
                      type="button"
                      onClick={() => handleGoLive(stream.id)}
                      disabled={actionId === stream.id}
                      className="rounded-lg bg-[#D9A72A] px-3 py-1.5 text-xs font-semibold text-[#17212B] hover:opacity-90 disabled:opacity-60"
                    >
                      {actionId === stream.id ? "…" : "Go live"}
                    </button>
                  )}
                  {isLive && (
                    <button
                      type="button"
                      onClick={() => handleEnd(stream.id)}
                      disabled={actionId === stream.id}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                    >
                      {actionId === stream.id ? "…" : "End stream"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleShowIngest(stream.id)}
                    disabled={ingestLoadingId === stream.id}
                    className="rounded-lg border border-[#174A7E]/20 px-3 py-1.5 text-xs font-medium text-[#174A7E] hover:bg-[#174A7E]/5 disabled:opacity-60"
                  >
                    {ingestLoadingId === stream.id
                      ? "Loading…"
                      : ingest
                      ? "Hide streaming details"
                      : "Show streaming details"}
                  </button>
                </div>

                {ingest && (
                  <div className="mt-3 rounded-lg bg-red-50 p-3 ring-1 ring-red-100">
                    <p className="mb-2 text-xs font-semibold text-red-700">
                      ⚠ Secret — never share this. Anyone with the stream key can broadcast as
                      your church.
                    </p>
                    {ingest.rtmp_url && (
                      <div className="mb-2 flex items-center gap-2">
                        <code className="flex-1 truncate rounded bg-white px-2 py-1 text-[11px] text-[#17212B]">
                          {ingest.rtmp_url}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(ingest.rtmp_url)}
                          className="shrink-0 text-[11px] font-medium text-[#174A7E] hover:underline"
                        >
                          Copy
                        </button>
                      </div>
                    )}
                    {ingest.stream_key && (
                      <div className="flex items-center gap-2">
                        <code className="flex-1 truncate rounded bg-white px-2 py-1 text-[11px] text-[#17212B]">
                          {ingest.stream_key}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(ingest.stream_key)}
                          className="shrink-0 text-[11px] font-medium text-[#174A7E] hover:underline"
                        >
                          Copy
                        </button>
                      </div>
                    )}
                    <p className="mt-2 text-[11px] text-[#17212B]/50">
                      Paste these into your broadcasting software (OBS, etc.) under Stream
                      settings.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
      </main>
    </div>
  );
}

// =====================================================================
// 7R. FAITHAI PAGE
// =====================================================================

const FAITHAI_MODE_OPTIONS = ["general", "devotional", "theology", "counsel"];

/**
 * Chat-style interface for the AI faith assistant. Route: /faithai
 * Assumes GET /faithai/history returns newest-first (consistent with every
 * other paginated list endpoint's limit/offset pattern here) — reversed
 * for display so it reads oldest-to-newest like a normal conversation.
 */
function FaithAIPage() {
  const [entries, setEntries] = useState([]); // oldest → newest for display
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState(FAITHAI_MODE_OPTIONS[0]);
  const [customMode, setCustomMode] = useState("");
  const [useCustomMode, setUseCustomMode] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");

  const bottomRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    apiGetFaithAIHistory({ limit: 30 })
      .then((data) => {
        if (cancelled) return;
        const page = Array.isArray(data) ? data : [];
        setEntries([...page].reverse());
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Couldn't load your FaithAI history.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [loading]);

  async function handleAsk(e) {
    e.preventDefault();
    const trimmed = question.trim();
    const finalMode = useCustomMode ? customMode.trim() : mode;
    if (!trimmed || !finalMode) return;

    setAsking(true);
    setAskError("");
    try {
      const result = await apiAskFaithAI({ question: trimmed, mode: finalMode });
      setEntries((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          question: result.question,
          answer: result.answer,
          mode: result.mode,
          created_at: new Date().toISOString(),
        },
      ]);
      setQuestion("");
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: "end" }));
    } catch (err) {
      setAskError(err?.message || "Couldn't get an answer right now.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#EEF5FB]">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to="/feed" className="text-sm font-medium text-white/70 hover:text-white">
          ← Back to feed
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">FaithAI</h1>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-4 sm:px-6">
        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading…</p>}

        {!loading && error && entries.length === 0 && (
          <p className="text-center text-sm text-red-600">{error}</p>
        )}

        {!loading && !error && entries.length === 0 && (
          <p className="py-8 text-center text-sm text-[#17212B]/60">
            Ask a question about faith, scripture, or life — answers show up here.
          </p>
        )}

        <div className="flex-1 space-y-3">
          {entries.map((entry) => (
            <div key={entry.id} className="space-y-2">
              <div className="ml-auto max-w-[85%] rounded-2xl bg-[#174A7E] px-3.5 py-2 text-sm text-white">
                {entry.question}
              </div>
              <div className="mr-auto max-w-[85%] rounded-2xl bg-white px-3.5 py-2 text-sm text-[#17212B] shadow-sm ring-1 ring-black/5">
                <p className="whitespace-pre-wrap leading-relaxed">{entry.answer}</p>
                <p className="mt-1.5 text-[10px] text-[#17212B]/40">{entry.mode}</p>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {askError && <p className="mt-2 text-center text-xs text-red-600">{askError}</p>}

        <form onSubmit={handleAsk} className="mt-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {!useCustomMode ? (
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="rounded-lg border border-[#17212B]/15 bg-white px-2 py-1.5 text-xs text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              >
                {FAITHAI_MODE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={customMode}
                onChange={(e) => setCustomMode(e.target.value)}
                placeholder="mode…"
                className="w-28 rounded-lg border border-[#17212B]/15 bg-white px-2 py-1.5 text-xs text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              />
            )}
            <button
              type="button"
              onClick={() => setUseCustomMode((v) => !v)}
              className="text-xs font-medium text-[#174A7E] hover:underline"
            >
              {useCustomMode ? "Use a preset mode" : "Custom mode"}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question…"
              className="flex-1 rounded-full border border-[#17212B]/15 bg-white px-4 py-2.5 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />
            <button
              type="submit"
              disabled={asking || !question.trim()}
              className="shrink-0 rounded-full bg-[#D9A72A] px-5 py-2.5 text-sm font-semibold text-[#17212B] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {asking ? "…" : "Ask"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

// =====================================================================
// 8. APP + ROUTER
// =====================================================================

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/feed"
            element={
              <ProtectedRoute>
                <FeedPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/churches/:churchId/timeline"
            element={
              <ProtectedRoute>
                <ChurchTimelinePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/churches/:churchId/chat"
            element={
              <ProtectedRoute>
                <GroupChatPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/churches/:churchId/stories"
            element={
              <ProtectedRoute>
                <StoriesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/churches/new"
            element={
              <ProtectedRoute>
                <CreateChurchPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/churches/:churchId/manage"
            element={
              <ProtectedRoute>
                <ManageChurchPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/prayer-wall"
            element={
              <ProtectedRoute>
                <PrayerWallPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/discussions"
            element={
              <ProtectedRoute>
                <DiscussionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/discussions/:threadId"
            element={
              <ProtectedRoute>
                <ThreadPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/events"
            element={
              <ProtectedRoute>
                <EventsDiscoverPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/events/:eventId"
            element={
              <ProtectedRoute>
                <EventDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/churches/:churchId/events/new"
            element={
              <ProtectedRoute>
                <CreateEventPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/speakers"
            element={
              <ProtectedRoute>
                <SpeakersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/groups"
            element={
              <ProtectedRoute>
                <GroupsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/live"
            element={
              <ProtectedRoute>
                <LiveNowPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/churches/:churchId/livestreams"
            element={
              <ProtectedRoute>
                <ChurchLivestreamsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/faithai"
            element={
              <ProtectedRoute>
                <FaithAIPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/churches"
            element={
              <ProtectedRoute>
                <BrowseChurchesPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
