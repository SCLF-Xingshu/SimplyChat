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
    // logged in: load from supabase using GitHub username
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
    // not logged in: load from localStorage
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
    // logged in: use supabase with GitHub username
    const githubUsername = currentUser.user_metadata.user_name;
    const { error } = await supabase
      .from('user_follows')
      .insert({ username: githubUsername, room_id: roomId });
    
    if (error) {
      console.error('follow error:', error);
      return false;
    }
  }
  // always update local cache and localStorage
  followingRooms.add(roomId);
  saveFollowsToLocal();
  return true;
}
// end 8

// 9 - unfollow a room
async function unfollowRoom(roomId) {
  if (!followingRooms.has(roomId)) return true;

  if (currentUser) {
    // logged in: delete from supabase using GitHub username
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

  // don't notify for own messages
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
  await initRealtimeSubscription();

  // 21.2 - check if user is in cooldown on page load
  isRateLimited();
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
} else if (parts[2] === 'chat' && parts[3]) {
  roomId = parts[3].toLowerCase();
} else if (parts[2] && parts[2] !== 'chat' && parts[2] !== '') {
  roomId = parts[2].toLowerCase();
} else {
  roomId = 'global';
}
console.log('detected roomId:', roomId);

// 26.1 - check if room is an old official room (disabled)
const oldOfficialRooms = ['feedback', 'simplychat', 'welcome'];
let isDisabledOldRoom = oldOfficialRooms.includes(roomId);
// end 26.1

// 26.2 - check if room name exceeds 32 characters
const MAX_ROOM_LENGTH = 32;
let isTooLongRoom = roomId.length > MAX_ROOM_LENGTH;
// end 26.2
// end 26

// 27 - dynamic page title
if (roomId !== 'global') {
  document.title = 'SimplyChat / ' + roomId;
}
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
    charCount.textContent = `${messageInput.value.length} / 1000`;
  });
}
// end 31

// 32 - display a message in the chat
function addMessage(msg) {
  if (!messagesDiv) return;
  const div = document.createElement('div');
  div.classList.add('message');

  const date = new Date(msg.created_at);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const tzParts = date.toLocaleTimeString(undefined, { timeZoneName: 'short' }).split(' ');
  const tz = tzParts[tzParts.length - 1] || '';

  let safeText = DOMPurify.sanitize(msg.content);
  safeText = safeText.replace(/\n/g, '<br>');

  div.innerHTML = `
    <div class="msg-header">[${day}/${month}/${year} ${hours}:${minutes} ${tz}] ${formatUsername(msg.username)}:</div>
    <div class="msg-content">${safeText}</div>
  `;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
// end 32

// 33 - load existing messages from supabase
async function loadMessages() {
  // 33.1 - handle disabled old official rooms
  const loadingIndicator = document.getElementById('loading-indicator');
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
  // end 33.1
  
  // 33.2 - show loading indicator
  const loadingIndicator = document.getElementById('loading-indicator');
  if (loadingIndicator) {
    loadingIndicator.style.display = 'block';
  }
  // end 33.2
  
  // 33.3 - handle too long room names
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
  // end 33.3

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

  // 33.4 - hide loading indicator
  if (loadingIndicator) {
    loadingIndicator.style.display = 'none';
  }
  // end 33.4
  
  const customMessages = {
    '!feedback': 'Welcome to the feedback page!',
    '!simplychat': 'Find here the latest infos about SimplyChat.',
    '!welcome': 'Introduce yourself to SimplyChat!'
  };
  const noWelcomeRooms = ['!feedback', '!simplychat', '!welcome'];
  
  const addSystemMessage = (text, insertAtTop) => {
    const div = document.createElement('div');
    div.classList.add('message');
    div.style.fontStyle = 'italic';
    div.style.color = '#8c8c8c';
    div.textContent = text;
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

  // 33.5 - show lock status for admin-only rooms
  if (roomId.startsWith('!') && !isDisabledOldRoom) {
    const isUnlocked = await isAdminRoomUnlocked(roomId);
    if (!isUnlocked) {
      addSystemMessage('🔒 This room is admin‑only. Only admins can send the first message.', false);
    }
  }
  // end 33.5

  if (messages && messages.length > 0) {
    messages.forEach(addMessage);
  } else {
    addSystemMessage('server : no messages yet.', false);
  }
}
// end 33

// 34 - start loading messages
if (messagesDiv) loadMessages();
// end 34

// 35 - room index for explore page
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
// end 35

// 36 - send message
if (isChatPage) {
  sendBtn.addEventListener('click', async () => {
    // 36.1 - generate username using stored local user ID
    let username;
    if (currentUser) {
      username = `[GH]${currentUser.user_metadata.user_name}`;
    } else {
      username = `anon${currentUserId}`;
    }
    // end 36.1
    
    // 36.2 - block sending in disabled old official rooms
    if (isDisabledOldRoom) {
      alert('This chatroom is disabled. Please use the official room link shown above.');
      return;
    }
    // end 36.2
    
    // 36.3 - block sending in rooms with name too long
    if (isTooLongRoom) {
      alert(`The chatroom name "${roomId}" is too long. The maximum length is ${MAX_ROOM_LENGTH} characters.`);
      return;
    }
    // end 36.3
    
    // 36.4 - admin-only room restriction for !-prefixed rooms
    if (roomId.startsWith('!') && !isDisabledOldRoom) {
      const isUnlocked = await isAdminRoomUnlocked(roomId);
      const isAdmin = isAdminUser(username);
      if (!isUnlocked && !isAdmin) {
        alert('This room is reserved for administrators. Only admins can send the first message.');
        return;
      }
    }
    // end 36.4

    // 36.5 - rate limiting check (5 second cooldown)
    if (isRateLimited()) {
      return;
    }
    // end 36.5

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
// end 36

// 37 - github login
if (githubLoginBtn) {
  githubLoginBtn.addEventListener('click', async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: 'https://sclf-xingshu.github.io/SimplyChat/' },
    });
  });
}
// end 37

// 38 - run the main initialisation
checkUser();
// end 38

// 39 - simple auth state change (only re‑runs checkuser)
supabase.auth.onAuthStateChange((_event, session) => {
  console.log('auth state changed', session ? 'logged in' : 'logged out');
  checkUser();
});
// end 39

// 40 - room search system (explore page)
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
// end 40

// 41 - debug: expose supabase for console
window.supabase = supabase;
console.log('supabase exposed to window. type window.supabase in console.');
// end 41

// 42 - check if user is admin
function isAdminUser(username) {
  const adminNames = ['[GH]SCLF-Xingshu', '[GH][ADMIN]SCLF-Xingshu'];
  return adminNames.includes(username);
}
// end 42

// 43 - check if admin room has any messages (unlocked)
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
// end 43

// 44 - logout function
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
// end 44

// 45 - logout button event listener
if (githubLogoutBtn) {
  githubLogoutBtn.addEventListener('click', logout);
}
// end 45
