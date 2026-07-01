// 1 - user identification (local user id, used for anonymous follows)
let currentUserId = null;
let currentHexId = null;
let followingRooms = new Set();
let chatChannel = null;
// end 1

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// 2 - helper: escape html (xss protection)
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
// end 2

// 2.1 - convert custom link syntax to HTML links
function renderCustomLinks(text) {
  // Match any \...\ pattern (simplified regex)
  return text.replace(/\\([^\\]+)\\/g, function(match, content) {
    const trimmed = content.trim();
    
    // Rule 1: @username → user profile link
    if (trimmed.startsWith('@') && !trimmed.startsWith('@/') && !trimmed.startsWith('@msg:')) {
      const username = trimmed.slice(1);
      return `<a href="/SimplyChat/user/${username}" class="custom-link">@${username}</a>`;
    }
    
    // Rule 2: @/room → chatroom link (with optional message ID)
    if (trimmed.startsWith('@/')) {
      const rest = trimmed.slice(2);
      
      // Check for message ID: @/room;msg:12345
      if (rest.includes(';msg:')) {
        const parts = rest.split(';msg:');
        const room = parts[0];
        const msgId = parts[1];
        return `<a href="/SimplyChat/chat/${room}#msg${msgId}" class="custom-link">@/${room};msg:${msgId}</a>`;
      }
      
      // Simple room link: @/room
      return `<a href="/SimplyChat/chat/${rest}" class="custom-link">@/${rest}</a>`;
    }
    
    // Rule 3: https:// → external link (only secure)
    if (trimmed.startsWith('https://')) {
      const displayText = trimmed.replace('https://', '');
      return `<a href="${trimmed}" class="custom-link" target="_blank" rel="noopener noreferrer">${displayText}</a>`;
    }
    
    // Rule 4: http:// → ignored (not a link)
    if (trimmed.startsWith('http://')) {
      return match;
    }
    
    // Rule 5: @msg:12345 → message link (uses current room)
    if (trimmed.startsWith('@msg:')) {
      const msgId = trimmed.slice(5);
      return `<a href="/SimplyChat/chat/${roomId}#msg${msgId}" class="custom-link">@msg:${msgId}</a>`;
    }
    
    // Rule 6: ~internalpage → internal page link
    if (trimmed.startsWith('~')) {
      const page = trimmed.slice(1);
      return `<a href="/SimplyChat/${page}" class="custom-link">~${page}</a>`;
    }
    
    // Rule 7: anything else → plain text (show backslashes)
    return match;
  });
}
// end 2.1

// 3 - format username (green [gh] tag)
function formatUsername(username) {
  const ghMatch = username.match(/^\[GH\]/);
  if (ghMatch) {
    const restOfName = username.slice(4);
    return `<span class="user-tag-gh">[GH]</span>${escapeHtml(restOfName)}`;
  }
  return escapeHtml(username);
}
// end 3

// 4 - generate random 12‑character hex string
function generateHexId() {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  return result;
}
// end 4

// 5 - create or retrieve local user id (localStorage only, no Supabase)
async function getOrCreateLocalUser() {
  const storedUserId = localStorage.getItem('simplychat_user_id');
  const storedHexId = localStorage.getItem('simplychat_hex_id');
  
  if (storedUserId && storedHexId) {
    currentUserId = parseInt(storedUserId);
    currentHexId = storedHexId;
    console.log('local user restored (localStorage):', currentUserId);
    return;
  }
  
  currentUserId = Date.now();
  currentHexId = generateHexId();
  
  localStorage.setItem('simplychat_user_id', currentUserId);
  localStorage.setItem('simplychat_hex_id', currentHexId);
  console.log('new local user created (localStorage only):', currentUserId);
}
// end 5

// 6 - save follows to localstorage (for anonymous users)
function saveFollowsToLocal() {
  localStorage.setItem('simplychat_following', JSON.stringify([...followingRooms]));
}
// end 6

// 7 - load followed rooms from correct source
async function loadFollowedRooms() {
  console.log('loadFollowedRooms() started');
  followingRooms.clear();

  if (currentUser) {
    const githubUsername = currentUser.user_metadata.user_name;
    const { data, error } = await supabase
      .from('user_follows')
      .select('room_id')
      .eq('username', githubUsername);
    
    if (!error && data) {
      data.forEach(item => followingRooms.add(item.room_id));
    } else if (error) {
      console.error('error loading follows from supabase:', error);
    }
  } else {
    const stored = localStorage.getItem('simplychat_following');
    if (stored) {
      const rooms = JSON.parse(stored);
      rooms.forEach(room => followingRooms.add(room));
    }
  }
  console.log('followed rooms:', [...followingRooms]);
}
// end 7

// 8 - follow a room (supabase if logged in, else localstorage)
async function followRoom(roomId) {
  if (followingRooms.has(roomId)) return true;

  if (currentUser) {
    const githubUsername = currentUser.user_metadata.user_name;
    const { error } = await supabase
      .from('user_follows')
      .insert({ username: githubUsername, room_id: roomId });
    
    if (error) {
      console.error('follow error:', error);
      return false;
    }
  }
  followingRooms.add(roomId);
  saveFollowsToLocal();
  return true;
}
// end 8

// 9 - unfollow a room
async function unfollowRoom(roomId) {
  if (!followingRooms.has(roomId)) return true;

  if (currentUser) {
    const githubUsername = currentUser.user_metadata.user_name;
    const { error } = await supabase
      .from('user_follows')
      .delete()
      .eq('username', githubUsername)
      .eq('room_id', roomId);
    
    if (error) {
      console.error('unfollow error:', error);
      return false;
    }
  }
  followingRooms.delete(roomId);
  saveFollowsToLocal();
  return true;
}
// end 9

// 10 - request browser notification permission
async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.log('notifications not supported');
    return false;
  }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  return false;
}
// end 10

// 11 - send a browser notification
function sendNotification(roomId, username, content) {
  if (Notification.permission !== 'granted') return;

  if (currentUser) {
    const githubName = currentUser.user_metadata?.user_name;
    if (githubName && (username === `[GH]${githubName}` || username === `[GH] ${githubName}`)) {
      return;
    }
  }

  const notification = new Notification(`New message in ${roomId}`, {
    body: `${username}: ${content.substring(0, 100)}${content.length > 100 ? '…' : ''}`,
    icon: '/SimplyChat/logo.svg',
    tag: roomId,
  });
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
  setTimeout(() => notification.close(), 15000);
}
// end 11

// 12 - rate limiting helper functions
function getRateLimitKey() {
  if (currentUser) {
    return `simplychat_lastmessage_${currentUser.user_metadata.user_name}`;
  } else {
    return `simplychat_lastmessage_anon_${currentUserId}`;
  }
}
// end 12

// 13 - cooldown countdown variables
let cooldownInterval = null;
const cooldownDisplay = document.getElementById('cooldown-countdown');
// end 13

// 14 - update countdown display
function updateCooldownDisplay(secondsLeft) {
  if (cooldownDisplay) {
    if (secondsLeft > 0) {
      cooldownDisplay.textContent = `Cooldown: ${secondsLeft}s`;
      cooldownDisplay.classList.add('visible');
    } else {
      cooldownDisplay.textContent = '';
      cooldownDisplay.classList.remove('visible');
      if (cooldownInterval) {
        clearInterval(cooldownInterval);
        cooldownInterval = null;
      }
    }
  }
}
// end 14

// 15 - start cooldown countdown timer
function startCooldownTimer() {
  if (cooldownInterval) {
    clearInterval(cooldownInterval);
  }
  
  cooldownInterval = setInterval(() => {
    const key = getRateLimitKey();
    const lastMessageTime = localStorage.getItem(key);
    const now = Date.now();
    const COOLDOWN_SECONDS = 5;
    const COOLDOWN_MS = COOLDOWN_SECONDS * 1000;
    
    if (lastMessageTime) {
      const timeSinceLastMessage = now - parseInt(lastMessageTime);
      if (timeSinceLastMessage < COOLDOWN_MS) {
        const secondsLeft = Math.ceil((COOLDOWN_MS - timeSinceLastMessage) / 1000);
        updateCooldownDisplay(secondsLeft);
      } else {
        updateCooldownDisplay(0);
      }
    } else {
      updateCooldownDisplay(0);
    }
  }, 200);
}
// end 15

// 16 - check if user is rate limited (5 second cooldown)
function isRateLimited() {
  const key = getRateLimitKey();
  const lastMessageTime = localStorage.getItem(key);
  const now = Date.now();
  const COOLDOWN_SECONDS = 5;
  const COOLDOWN_MS = COOLDOWN_SECONDS * 1000;
  
  if (lastMessageTime) {
    const timeSinceLastMessage = now - parseInt(lastMessageTime);
    if (timeSinceLastMessage < COOLDOWN_MS) {
      const secondsLeft = Math.ceil((COOLDOWN_MS - timeSinceLastMessage) / 1000);
      updateCooldownDisplay(secondsLeft);
      startCooldownTimer();
      return true;
    }
  }
  updateCooldownDisplay(0);
  return false;
}
// end 16

// 17 - record message timestamp in localStorage
function recordMessageTimestamp() {
  const key = getRateLimitKey();
  localStorage.setItem(key, Date.now().toString());
  startCooldownTimer();
}
// end 17

// 18 - update follow button text and style
async function updateFollowButton() {
  const followBtn = document.getElementById('follow-btn');
  
  // 18.1 - hide follow button in disabled old rooms
  if (isDisabledOldRoom) {
    if (followBtn) followBtn.style.display = 'none';
    return;
  }
  // end 18.1
  
  // 18.2 - hide follow button in rooms with name too long
  if (isTooLongRoom) {
    if (followBtn) followBtn.style.display = 'none';
    return;
  }
  // end 18.2
  
  if (!followBtn) return;

  if (!currentUserId) {
    followBtn.style.display = 'none';
    return;
  }

  const following = followingRooms.has(roomId);
  followBtn.style.display = 'inline-block';
  if (following) {
    followBtn.textContent = `🔕 Unfollow /${roomId}`;
    followBtn.classList.add('following');
    followBtn.classList.remove('not-following');
  } else {
    followBtn.textContent = `🔔 Follow /${roomId}`;
    followBtn.classList.add('not-following');
    followBtn.classList.remove('following');
  }
}
// end 18

// 19 - ui updates when user logs in/out
function updateUIForUser() {
  const usernameInput = document.getElementById('username');
  if (currentUser && usernameInput) {
    const githubUsername = currentUser.user_metadata.user_name;
    usernameInput.value = `[GH] ${githubUsername}`;
    usernameInput.disabled = true;
  } else if (usernameInput) {
    usernameInput.value = '';
    usernameInput.disabled = false;
  }
  updateFollowButton();
}
// end 19

// 20 - realtime subscription (always connects)
async function initRealtimeSubscription() {
  console.log('creating realtime subscription for room:', roomId);

  if (chatChannel) {
    console.log('removing existing subscription');
    await supabase.removeChannel(chatChannel);
  }

  chatChannel = supabase
    .channel(`room:${roomId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'simplychat_messages',
      filter: `room_id=eq.${roomId.toLowerCase()}`,
    }, async (payload) => {
      console.log('new message received in realtime!');
      addMessage(payload.new);

      const canNotify = Notification.permission === 'granted';
      const isFollowing = followingRooms.has(roomId);
      if (canNotify && isFollowing) {
        sendNotification(roomId, payload.new.username, payload.new.content);
      }
    })
    .subscribe((status, err) => {
      console.log('realtime status:', status, err || '');
      if (status === 'subscribed') {
        console.log('successfully subscribed to room:', roomId);
      }
    });
}
// end 20

// 21 - main initialisation (single source of truth)
async function checkUser() {
  console.log('checkUser() started');

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) console.error('session error:', error);

  currentUser = session?.user || null;
  console.log('currentUser:', currentUser ? currentUser.user_metadata.user_name : 'null');

  // 21.1 - show/hide login/logout buttons
  if (currentUser) {
    if (githubLoginBtn) githubLoginBtn.style.display = 'none';
    if (githubLogoutBtn) githubLogoutBtn.style.display = 'block';
  } else {
    if (githubLoginBtn) githubLoginBtn.style.display = 'block';
    if (githubLogoutBtn) githubLogoutBtn.style.display = 'none';
  }
  // end 21.1

  if (!currentUserId) {
    await getOrCreateLocalUser();
  }

  await loadFollowedRooms();
  updateUIForUser();
  
  // 21.3 - only initialize realtime subscription on chat pages
  if (isChatPage) {
    await initRealtimeSubscription();
  }
  // end 21.3

  // 21.2 - check if user is in cooldown on page load (only on chat pages)
  if (isChatPage) {
    isRateLimited();
  }
  // end 21.2

  console.log('checkUser() completed');
}
// end 21

// 22 - follow button event listener
const followBtn = document.getElementById('follow-btn');
if (followBtn) {
  followBtn.addEventListener('click', async () => {
    if (!currentUserId) {
      await getOrCreateLocalUser();
      await loadFollowedRooms();
    }

    const currentlyFollowing = followingRooms.has(roomId);
    if (!currentlyFollowing) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        alert('please allow notifications in your browser settings to follow rooms.');
        return;
      }
      await followRoom(roomId);
    } else {
      await unfollowRoom(roomId);
    }
    await updateFollowButton();
  });
}
// end 22

// 23 - supabase setup
const supabaseUrl = 'https://koprmimlvjziuznbntzc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvcHJtaW1sdmp6aXV6bmJudHpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExMDI2NjYsImV4cCI6MjA4NjY3ODY2Nn0.hPp-Fx6o7LtBSW_YIuw7WtJd73z8l1KLbg-O5UbPWeU';
const supabase = createClient(supabaseUrl, supabaseKey);

let roomsIndex = [];
// end 23

// 24 - redirect handling (for 404 fallback)
const redirect = sessionStorage.getItem('redirect');
if (redirect) {
  sessionStorage.removeItem('redirect');
  window.history.replaceState({}, '', redirect);
}
// end 24

// 25 - build room index (for explore / search)
async function fetchRoomsIndex() {
  const { data, error } = await supabase
    .from('simplychat_messages')
    .select('room_id, created_at');
  if (error) {
    console.error(error);
    return [];
  }
  const map = {};
  data.forEach(row => {
    const room = row.room_id.toLowerCase();
    if (!map[room]) {
      map[room] = { id: room, count: 0, lastActivity: 0 };
    }
    map[room].count++;
    const time = new Date(row.created_at).getTime();
    if (time > map[room].lastActivity) map[room].lastActivity = time;
  });
  return Object.values(map);
}
// end 25

// 26 - room id detection (supports /chat/room and direct /room)
const parts = window.location.pathname.split('/');
let roomId;
const redirectPath = sessionStorage.getItem('redirect');

if (redirectPath) {
  const redirectParts = redirectPath.split('/');
  if (redirectParts[2] === 'chat' && redirectParts[3]) {
    roomId = redirectParts[3].toLowerCase();
  } else if (redirectParts[2] && redirectParts[2] !== 'chat' && redirectParts[2] !== '') {
    roomId = redirectParts[2].toLowerCase();
  } else {
    roomId = 'global';
  }
  
  // Restore hash if present in redirect path
  if (redirectPath.includes('#')) {
    const hash = redirectPath.split('#')[1];
    if (hash) {
      window.location.hash = '#' + hash;
    }
  }
} else if (parts[2] === 'chat' && parts[3]) {
  roomId = parts[3].toLowerCase();
} else if (parts[2] && parts[2] !== 'chat' && parts[2] !== '') {
  roomId = parts[2].toLowerCase();
} else {
  roomId = 'global';
}

// Clear the redirect after processing
sessionStorage.removeItem('redirect');

console.log('detected roomId:', roomId);

// 26.1 - update room ID display
const roomIdText = document.getElementById('room-id-text');
if (roomIdText) {
  roomIdText.textContent = `/${roomId}`;
}
// end 26.1

// 26.2 - check if room is an old official room (disabled)
const oldOfficialRooms = ['feedback', 'simplychat', 'welcome'];
let isDisabledOldRoom = oldOfficialRooms.includes(roomId);
// end 26.2

// 26.3 - check if room name exceeds 32 characters
const MAX_ROOM_LENGTH = 32;
let isTooLongRoom = roomId.length > MAX_ROOM_LENGTH;
// end 26.3
// end 26

// 27 - dynamic page title
if (parts[2] === 'chat' && parts[3]) {             // On a chatroom (https://sclf-xingshu.github.io/SimplyChat/chat/chatroomname)
  document.title = 'SimplyChat / ' + roomId;       //                part number  |   ↑[0]             ↑[1]     ↑[2]     ↑[3]   
} else if (roomId === 'global' && !parts[2]) {     // Not on a chatroom AND on the homepage (https://sclf-xingshu.github.io/SimplyChat/)
  document.title = 'SimplyChat.';                  //                part number  |                           ↑[0]             ↑[1]
}
// For other pages, keep the title set in the HTML.
// end 27

// 28 - clean url (if needed)
if (parts[3] && parts[3] !== roomId) {
  window.history.replaceState({}, '', `/SimplyChat/chat/${roomId}`);
}
// end 28

// 29 - dom elements
const messagesDiv = document.getElementById('messages');
const usernameInput = document.getElementById('username');
const messageInput = document.getElementById('message');
const charCount = document.getElementById('char-count');
const sendBtn = document.getElementById('send');
const githubLoginBtn = document.getElementById('github-login');
const githubLogoutBtn = document.getElementById('github-logout');
const isChatPage = messagesDiv && messageInput && charCount && sendBtn;
const isExplorePage = document.getElementById('explore-results') && document.getElementById('explore-mode');
const fontSlider = document.getElementById('font-slider');
const fontSizeDisplay = document.getElementById('font-size-display');

let currentUser = null;

  // 29.1 - helper to get current username
  function getCurrentUsername() {
    if (currentUser) {
      return `[GH]${currentUser.user_metadata.user_name}`;
    } else {
      const customName = usernameInput ? usernameInput.value.trim() : '';
      if (customName !== '') {
        return customName;
      }
      return `anon${currentUserId}`;
    }
  }
  // end 29.1
// end 29

// 30 - font size persistence
const savedFontSize = localStorage.getItem('fontSize');
if (savedFontSize) {
  document.documentElement.style.setProperty('--font-size', savedFontSize + 'px');
  if (fontSlider) fontSlider.value = savedFontSize;
  if (fontSizeDisplay) fontSizeDisplay.textContent = savedFontSize + 'px';
}
if (fontSlider && fontSizeDisplay) {
  fontSlider.addEventListener('input', () => {
    const size = fontSlider.value;
    document.documentElement.style.setProperty('--font-size', size + 'px');
    fontSizeDisplay.textContent = size + 'px';
    localStorage.setItem('fontSize', size);
  });
}
// end 30

// 31 - character counter
if (isChatPage && messageInput && charCount) {
  messageInput.addEventListener('input', () => {
    const length = messageInput.value.length;
    charCount.textContent = `${length} / 1000`;
    
    // 31.1 - announce only at thresholds
    const thresholds = [900, 950, 990, 1000];
    if (thresholds.includes(length)) {
      charCount.setAttribute('role', 'status');
      charCount.setAttribute('aria-live', 'polite');
    } else {
      charCount.removeAttribute('role');
      charCount.removeAttribute('aria-live');
    }
    // end 31.1
  });
}
// end 31
// 32 - display a message in the chat
function addMessage(msg) {
  if (!messagesDiv) return;
  const div = document.createElement('div');
  div.classList.add('message');
  div.id = `msg${msg.id}`;

  const date = new Date(msg.created_at);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const tzParts = date.toLocaleTimeString(undefined, { timeZoneName: 'short' }).split(' ');
  const tz = tzParts[tzParts.length - 1] || '';

  let safeText = DOMPurify.sanitize(msg.content);
  safeText = renderCustomLinks(safeText);
  safeText = safeText.replace(/\n/g, '<br>');

  // 32.1 - build message HTML with report button
  const escapedUsername = escapeHtml(msg.username);
  div.innerHTML = `
    <div class="msg-header">[${day}/${month}/${year} ${hours}:${minutes} ${tz}] ${formatUsername(msg.username)} <span class="msg-id">#${msg.id}</span></div>
    <div class="msg-content">${safeText}</div>
    <div class="msg-actions">
      <button class="report-btn" data-msg-id="${msg.id}" data-msg-username="${escapedUsername}" aria-label="Report this message">🚨 Report</button>
    </div>
  `;
  // end 32.1

  // 32.2 - report button event listener
  const reportBtn = div.querySelector('.report-btn');
  if (reportBtn) {
    reportBtn.addEventListener('click', function() {
      const msgId = this.getAttribute('data-msg-id');
      const msgUsername = this.getAttribute('data-msg-username');
      openReportModal(msgId, msgUsername);
    });
  }
  // end 32.2
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
// end 32

// 33 - scroll to message if URL has #msg12345 (moved before loadMessages)
function scrollToMessageIfNeeded() {
  const hash = window.location.hash;
  if (hash && hash.startsWith('#msg')) {
    const target = document.getElementById(hash.slice(1));
    if (target) {
      // Small delay to ensure messages are rendered
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }
}
  // 32.3 - report modal functions
  function openReportModal(msgId, msgUsername) {
    const modal = document.getElementById('report-modal');
    if (!modal) return;
    
    // Store message ID and username in the form
    const msgIdField = document.getElementById('report-msg-id');
    const msgUsernameField = document.getElementById('report-msg-username');
    if (msgIdField) msgIdField.value = msgId;
    if (msgUsernameField) msgUsernameField.value = msgUsername;
    
    // Clear previous values
    const reasonSelect = document.getElementById('report-reason');
    const detailsTextarea = document.getElementById('report-details');
    const errorDisplay = document.getElementById('report-error');
    if (reasonSelect) reasonSelect.value = '';
    if (detailsTextarea) detailsTextarea.value = '';
    if (errorDisplay) errorDisplay.textContent = '';
    
    // Show modal
    modal.removeAttribute('hidden');
    modal.style.display = 'block';
    
    // Focus first input
    setTimeout(() => {
      if (reasonSelect) reasonSelect.focus();
    }, 100);
  }
  // end 32.3
  
  // 32.4 - close report modal
  function closeReportModal() {
    const modal = document.getElementById('report-modal');
    if (modal) {
      modal.setAttribute('hidden', '');
      modal.style.display = 'none';
    }
  }
  // end 32.4
// end 33

// 34 - load existing messages from supabase
async function loadMessages() {
  const loadingIndicator = document.getElementById('loading-indicator');
  // 34.1 - handle disabled old official rooms
  if (isDisabledOldRoom) {
    messagesDiv.innerHTML = '';
    const disabledDiv = document.createElement('div');
    disabledDiv.classList.add('message');
    disabledDiv.style.fontStyle = 'italic';
    disabledDiv.style.color = '#ff4444';
    disabledDiv.style.textAlign = 'center';
    disabledDiv.style.padding = '20px';
    const newRoomId = `!${roomId}`;
    disabledDiv.innerHTML = `
      ⚠️ This chatroom is disabled.<br>
      Did you mean: <a href="/SimplyChat/chat/${newRoomId}" style="color: #0FBF3E;">/${newRoomId}</a>, 
      the SimplyChat official ${roomId} page?
    `;
    messagesDiv.appendChild(disabledDiv);
    if (loadingIndicator) loadingIndicator.style.display = 'none';
    return;
  }
  // end 34.1
  
  // 34.2 - show loading indicator
  if (loadingIndicator) {
    loadingIndicator.style.display = 'block';
  }
  // end 34.2
  
  // 34.3 - handle too long room names
  if (isTooLongRoom) {
    messagesDiv.innerHTML = '';
    const errorDiv = document.createElement('div');
    errorDiv.classList.add('message');
    errorDiv.style.fontStyle = 'italic';
    errorDiv.style.color = '#ff4444';
    errorDiv.style.textAlign = 'center';
    errorDiv.style.padding = '20px';
    const roomNameLength = roomId.length;
    errorDiv.innerHTML = `
      ⚠️ The chatroom name "<strong>${escapeHtml(roomId)}</strong>" (${roomNameLength} characters) is too long.<br>
      The maximum length is ${MAX_ROOM_LENGTH} characters. Please try a shorter name.
    `;
    messagesDiv.appendChild(errorDiv);
    if (loadingIndicator) loadingIndicator.style.display = 'none';
    return;
  }
  // end 34.3

  if (!messagesDiv) return;
  
  let query = supabase
    .from('simplychat_messages')
    .select('*')
    .order('created_at', { ascending: true });
  if (roomId === 'global') {
    query = query.eq('room_id', 'global');
  } else {
    query = query.eq('room_id', roomId);
  }
  const { data: messages, error } = await query;
  console.log('messages returned:', messages?.length || 0);

  if (error) {
    console.error('error loading messages:', error);
    return;
  }

  // 34.4 - hide loading indicator
  if (loadingIndicator) {
    loadingIndicator.style.display = 'none';
  }
  // end 34.4
  
  const customMessages = {
    'global': 'This is the main chatroom. Create your own using the <a href="https://sclf-xingshu.github.io/SimplyChat/create">Create</a> page!',
    '!feedback': 'Welcome to the feedback page!\nNote: if you encountered a bug, report it here: <a href="https://sclf-xingshu.github.io/SimplyChat/chat/!bugs">/!bugs</a>\nThank you!',
    '!simplychat': 'Find here the latest infos about SimplyChat.',
    '!welcome': 'Introduce yourself to SimplyChat!',
    '!explore': 'Explore and discuss about chatrooms!',
    '!bugs': 'Found a bug ? Report it here !\nBe precise when describing the bug, so we can more easily fix it. Thank you !'
  };
  const noWelcomeRooms = ['!feedback'/*, '!simplychat', '!welcome'*/];
  
  const addSystemMessage = (text, insertAtTop) => {
    const div = document.createElement('div');
    div.classList.add('message');
    div.style.fontStyle = 'italic';
    div.style.color = '#8c8c8c';
    div.innerHTML = text.replace(/\n/g, '<br>');
    if (insertAtTop) {
      messagesDiv.insertBefore(div, messagesDiv.firstChild);
    } else {
      messagesDiv.appendChild(div);
    }
  };

  if (!noWelcomeRooms.includes(roomId)) {
    addSystemMessage(`Welcome to /${roomId}!`, true);
  }
  if (customMessages[roomId]) {
    addSystemMessage(customMessages[roomId], false);
  }
  // 34.5 - official room notice for !-prefixed rooms
  if (roomId.startsWith('!') && !isDisabledOldRoom) {
    addSystemMessage(`Note: you are on /${roomId}. Chatrooms starting with "!" are official SimplyChat chatrooms.`, false);
  }
  // end 34.5
  // 34.6 - show lock status for admin-only rooms
  if (roomId.startsWith('!') && !isDisabledOldRoom) {
    const isUnlocked = await isAdminRoomUnlocked(roomId);
    if (!isUnlocked) {
      addSystemMessage('🔒 This chatroom is admin‑only. Only admins can send the first message and unlock this room.', false);
    }
  }
  // end 34.6

  if (messages && messages.length > 0) {
    messages.forEach(addMessage);
  } else {
    addSystemMessage('Server : no messages yet.', false);
  }
  // 34.7 - scroll to message if needed
  scrollToMessageIfNeeded();
  // end 34.7
}
// end 34

// 35 - start loading messages
if (isChatPage) loadMessages();
// end 35

// 36 - room index for explore page
async function initRooms() {
  roomsIndex = await fetchRoomsIndex();
}

if (isExplorePage) {
  loadExplore();
  document.getElementById('explore-mode').addEventListener('change', () => loadExplore());
}

async function loadExplore() {
  const rooms = await fetchRoomsIndex();
  const mode = document.getElementById('explore-mode').value;
  renderExplore(rooms, mode);
}

function renderExplore(rooms, mode) {
  const container = document.getElementById('explore-results');
  container.innerHTML = '';
  let sorted = [...rooms];
  if (mode === 'trending') sorted.sort((a, b) => b.lastActivity - a.lastActivity);
  else if (mode === 'popular') sorted.sort((a, b) => b.count - a.count);
  else if (mode === 'alphabetic') sorted.sort((a, b) => a.id.localeCompare(b.id));

  sorted.forEach(room => {
    const div = document.createElement('div');
    div.classList.add('explore-room');
    div.textContent = `${room.id} (${room.count} messages)`;
    div.onclick = () => window.location.href = `/SimplyChat/chat/${room.id}`;
    container.appendChild(div);
  });
}

initRooms();
// end 36

// 37 - send message
if (isChatPage) {
  sendBtn.addEventListener('click', async () => {
    // 37.1 - generate username (custom for anonymous, GitHub for logged in)
    let username;
    if (currentUser) {
      username = `[GH]${currentUser.user_metadata.user_name}`;
    } else {
      let customName = usernameInput.value.trim();
      const MAX_CUSTOM_NAME = 24;
      if (customName !== '') {
        if (customName.length > MAX_CUSTOM_NAME) {
          customName = customName.substring(0, MAX_CUSTOM_NAME);
          usernameInput.value = customName;
        }
        username = customName;
      } else {
        username = `anon${currentUserId}`;
      }
    }
    // end 37.1
    
    // 37.2 - block sending in disabled old official rooms
    if (isDisabledOldRoom) {
      alert('This chatroom is disabled. Please use the official room link shown above.');
      return;
    }
    // end 37.2
    
    // 37.3 - block sending in rooms with name too long
    if (isTooLongRoom) {
      alert(`The chatroom name "${roomId}" is too long. The maximum length is ${MAX_ROOM_LENGTH} characters.`);
      return;
    }
    // end 37.3
    
    // 37.4 - admin-only room restriction for !-prefixed rooms
    if (roomId.startsWith('!') && !isDisabledOldRoom) {
      const isUnlocked = await isAdminRoomUnlocked(roomId);
      const isAdmin = isAdminUser(username);
      if (!isUnlocked && !isAdmin) {
        alert('This room is reserved for administrators. Only admins can send the first message.');
        return;
      }
    }
    // end 37.4

    // 37.5 - rate limiting check (5 second cooldown)
    if (isRateLimited()) {
      return;
    }
    // end 37.5

    const content = messageInput.value.trim();
    if (!content) return;
    if (content.length > 1000) {
      alert('your message exceeds 1000 characters');
      return;
    }
    const { error } = await supabase.from('simplychat_messages').insert([{
      username,
      content,
      room_id: roomId.toLowerCase(),
    }]);
    if (error) {
      console.error('error inserting message:', error);
    } else {
      recordMessageTimestamp();
      messageInput.value = '';
      charCount.textContent = '0 / 1000';
    }
  });
}
// end 37

// 38 - github login
if (githubLoginBtn) {
  githubLoginBtn.addEventListener('click', async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: 'https://sclf-xingshu.github.io/SimplyChat/' },
    });
  });
}
// end 38

// 39 - run the main initialisation
checkUser();
// end 39

// 40 - simple auth state change (only re‑runs checkuser)
supabase.auth.onAuthStateChange((_event, session) => {
  console.log('auth state changed', session ? 'logged in' : 'logged out');
  checkUser();
});
// end 40

// 41 - room search system (explore page)
function initRoomSearchSystem() {
  const roomSearch = document.getElementById('room-search');
  const roomResults = document.getElementById('room-results');
  const roomMode = document.getElementById('room-mode');
  if (!roomSearch || !roomResults || !roomMode) return;

  function scoreMatch(text, query) {
    let score = 0;
    if (text === query) score += 100;
    if (text.includes(query)) score += 20;
    for (let i = 0; i < Math.min(text.length, query.length); i++) {
      if (text[i] === query[i]) score++;
    }
    return score;
  }

  function render(results, query, mode) {
    roomResults.innerHTML = '';
    if (!query) return;
    let finalResults = [...results];
    const exists = finalResults.some(r => r.id === query);
    if (!exists) {
      finalResults.unshift({ id: query, count: 0, lastActivity: 0, virtual: true });
    }
    if (mode === 'match') finalResults.sort((a, b) => scoreMatch(b.id, query) - scoreMatch(a.id, query));
    if (mode === 'popular') finalResults.sort((a, b) => b.count - a.count);
    if (mode === 'trending') finalResults.sort((a, b) => b.lastActivity - a.lastActivity);

    finalResults.forEach(room => {
      const div = document.createElement('div');
      div.textContent = room.virtual ? `${room.id} (new room)` : `${room.id} (${room.count})`;
      div.onclick = () => window.location.href = `/SimplyChat/chat/${room.id}`;
      roomResults.appendChild(div);
    });
  }

  roomSearch.addEventListener('input', () => {
    const query = roomSearch.value.toLowerCase().trim();
    const mode = roomMode.value;
    const filtered = roomsIndex.filter(room => room.id.includes(query));
    render(filtered, query, mode);
  });
}

initRoomSearchSystem();
// end 41

// 42 - debug: expose supabase for console
window.supabase = supabase;
console.log('supabase exposed to window. type window.supabase in console.');
// end 42

// 43 - check if user is admin
function isAdminUser(username) {
  const adminNames = ['[GH]SCLF-Xingshu', '[GH][ADMIN]SCLF-Xingshu'];
  return adminNames.includes(username);
}
// end 43

// 44 - check if admin room has any messages (unlocked)
async function isAdminRoomUnlocked(roomId) {
  if (!roomId.startsWith('!')) return true;
  const { data, error } = await supabase
    .from('simplychat_messages')
    .select('id')
    .eq('room_id', roomId)
    .limit(1);
  if (error) console.error('Unlock check error:', error);
  return data && data.length > 0;
}
// end 44

// 45 - logout function
async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('Logout error:', error);
    return;
  }
  currentUser = null;
  currentUserId = null;
  followingRooms.clear();
  localStorage.removeItem('simplychat_user_id');
  localStorage.removeItem('simplychat_hex_id');
  if (usernameInput) {
    usernameInput.value = '';
    usernameInput.disabled = false;
  }
  if (githubLogoutBtn) githubLogoutBtn.style.display = 'none';
  if (githubLoginBtn) githubLoginBtn.style.display = 'block';
  await loadFollowedRooms();
  updateUIForUser();
  updateFollowButton();
  location.reload();
}
// end 45

// 46 - logout button event listener
if (githubLogoutBtn) {
  githubLogoutBtn.addEventListener('click', logout);
}
// end 46

// 47 - report modal event listeners
const reportModal = document.getElementById('report-modal');
const reportClose = document.getElementById('report-modal-close');
const reportCancel = document.getElementById('report-cancel');
const reportForm = document.getElementById('report-form');
const reportError = document.getElementById('report-error');

if (reportModal && reportForm) {
  // 47.1 - close modal on close button
  if (reportClose) {
    reportClose.addEventListener('click', closeReportModal);
  }
  // end 47.1
  
  // 47.2 - close modal on cancel button
  if (reportCancel) {
    reportCancel.addEventListener('click', closeReportModal);
  }
  // end 47.2
  
  // 47.3 - close modal on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && reportModal && !reportModal.hasAttribute('hidden')) {
      closeReportModal();
    }
  });
  // end 47.3
  
  // 47.4 - close modal on outside click
  reportModal.addEventListener('click', function(e) {
    if (e.target === reportModal) {
      closeReportModal();
    }
  });
  // end 47.4
  
  // 47.5 - form submission (Phase 3 - Supabase insert)
  reportForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    const reason = document.getElementById('report-reason');
    const details = document.getElementById('report-details');
    const msgIdField = document.getElementById('report-msg-id');
    const msgUsernameField = document.getElementById('report-msg-username');
    
    // 47.5.1 - validate reason
    if (!reason || !reason.value) {
      if (reportError) reportError.textContent = 'Please select a reason.';
      return;
    }
    if (reportError) reportError.textContent = '';
    // end 47.5.1
    
    // 47.5.2 - disable submit button to prevent double submission
    const submitBtn = document.getElementById('report-submit');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
    }
    // end 47.5.2
    
    try {
      // 47.5.3 - prepare report data
      const reporterUsername = getCurrentUsername();
      const reportData = {
        message_id: parseInt(msgIdField ? msgIdField.value : '0'),
        reporter_username: reporterUsername,
        reported_username: msgUsernameField ? msgUsernameField.value : '',
        reason: reason.value,
        details: details ? details.value : '',
        status: 'pending'
      };
      // end 47.5.3
      
      // 47.5.4 - insert into Supabase
      const { data, error } = await supabase
        .from('reports')
        .insert([reportData])
        .select();
      
      if (error) {
        console.error('Error submitting report:', error);
        if (reportError) reportError.textContent = 'Failed to submit report. Please try again.';
        return;
      }
      // end 47.5.4
      
      // 47.5.5 - success
      console.log('Report submitted successfully:', data);
      alert('Report submitted. Thank you for helping keep SimplyChat safe!');
      closeReportModal();
      // end 47.5.5
      
    } catch (err) {
      // 47.5.6 - error handling
      console.error('Unexpected error:', err);
      if (reportError) reportError.textContent = 'An unexpected error occurred. Please try again.';
      // end 47.5.6
    } finally {
      // 47.5.7 - re-enable submit button
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Report';
      }
      // end 47.5.7
    }
  });
  // end 47.5
}
// end 47

// 48 - settings toggle
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');

if (settingsToggle && settingsPanel) {
  // 48.1 - toggle panel on gear click
  settingsToggle.addEventListener('click', function(e) {
    e.stopPropagation();
    const isVisible = settingsPanel.style.display === 'block';
    settingsPanel.style.display = isVisible ? 'none' : 'block';
    
    // 48.1.1 - update aria-expanded
    settingsToggle.setAttribute('aria-expanded', isVisible ? 'false' : 'true');
    // end 48.1.1
    
    // 48.1.2 - focus management
    if (!isVisible) {
      // panel is opening - move focus inside
      setTimeout(() => {
        const firstFocusable = settingsPanel.querySelector('button, input, select, textarea, a, [tabindex]:not([tabindex="-1"])');
        if (firstFocusable) {
          firstFocusable.focus();
        } else {
          settingsPanel.focus();
        }
      }, 100);
    } else {
      // panel is closing - return focus to toggle
      settingsToggle.focus();
    }
    // end 48.1.2
  });
  // end 48.1

  // 48.2 - close settings with Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && settingsPanel.style.display === 'block') {
      settingsPanel.style.display = 'none';
      settingsToggle.setAttribute('aria-expanded', 'false');
      settingsToggle.focus();
    }
  });
  // end 48.2

  // 48.3 - close panel when clicking outside
  document.addEventListener('click', function(e) {
    const container = document.getElementById('settings-container');
    if (container && !container.contains(e.target) && settingsPanel.style.display === 'block') {
      settingsPanel.style.display = 'none';
      settingsToggle.setAttribute('aria-expanded', 'false');
    }
  });
  // end 48.3
}
// end 48
