// 1 - User identification for notifications
let currentUserId = null;
let currentHexId = null;
let followingRooms = new Set();
// end 1

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatUsername(username) {
  const ghMatch = username.match(/^\[GH\]/);
  if (ghMatch) {
    const restOfName = username.slice(4);
    return `<span class="user-tag-gh">[GH]</span>${escapeHtml(restOfName)}`;
  }
  return escapeHtml(username);
}

// Generate random 12-character hex string (0~9, a~f)
function generateHexId() {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  return result;
}

// Get or create user (stored in users table)
async function getOrCreateUser() {
  console.log('getOrCreateUser() started');
  
  const storedUserId = localStorage.getItem('simplychat_user_id');
  const storedHexId = localStorage.getItem('simplychat_hex_id');
  console.log('localStorage - userId:', storedUserId, 'hexId:', storedHexId);
  
  // If we have stored IDs, try to use them
  if (storedUserId && storedHexId) {
    console.log('Found stored IDs, verifying with Supabase...');
    const { data, error } = await supabase
      .from('users')
      .select('user_id, hex_id')
      .eq('user_id', parseInt(storedUserId))
      .eq('hex_id', storedHexId)
      .maybeSingle();  // Changed from .single() to .maybeSingle()
    
    console.log('Supabase verification result:', data, error);
    
    if (!error && data) {
      currentUserId = data.user_id;
      currentHexId = data.hex_id;
      console.log('User verified, currentUserId:', currentUserId);
      return { userId: currentUserId, hexId: currentHexId };
    }
  }
  
  console.log('No existing user found, creating new user...');
  
  // Get the current highest user_id
  console.log('Querying for max user_id...');
  const { data: maxRow, error: maxError } = await supabase
    .from('users')
    .select('user_id')
    .order('user_id', { ascending: false })
    .limit(1);
  
  console.log('Max user_id query result:', maxRow);
  console.log('Max user_id query error:', maxError);
  
  // Determine new user_id
  let newUserId = 1;
  if (maxRow && maxRow.length > 0 && maxRow[0].user_id) {
    newUserId = maxRow[0].user_id + 1;
  }
  
  const newHexId = generateHexId();
  console.log('Attempting to insert user_id:', newUserId, 'hex_id:', newHexId);
  
  // Insert the new user
  const { data: insertData, error: insertError } = await supabase
    .from('users')
    .insert([{ user_id: newUserId, hex_id: newHexId }])
    .select();
  
  if (insertError) {
    console.error('ERROR creating user:', insertError.message);
    console.error('Full error:', insertError);
    return null;
  }
  
  console.log('Insert successful:', insertData);
  
  currentUserId = newUserId;
  currentHexId = newHexId;
  
  localStorage.setItem('simplychat_user_id', newUserId);
  localStorage.setItem('simplychat_hex_id', newHexId);
  
  console.log('New user created and saved!');
  return { userId: newUserId, hexId: newHexId };
}

// Load all rooms the current user follows
async function loadFollowedRooms() {
  if (!currentUserId) return;
  
  const { data, error } = await supabase
    .from('user_follows')
    .select('room_id')
    .eq('user_id', currentUserId);
  
  if (!error && data) {
    followingRooms.clear();
    data.forEach(item => followingRooms.add(item.room_id));
  }
}

// Check if user follows a specific room
async function isFollowingRoom(roomId) {
  if (!currentUserId) return false;
  return followingRooms.has(roomId);
}

// Follow a room
async function followRoom(roomId) {
  if (!currentUserId) {
    await getOrCreateUser();
    await loadFollowedRooms();
  }
  
  if (followingRooms.has(roomId)) return true;
  
  const { error } = await supabase
    .from('user_follows')
    .insert([{
      user_id: currentUserId,
      room_id: roomId
    }]);
  
  if (error) {
    console.error('Error following room:', error);
    return false;
  }
  
  followingRooms.add(roomId);
  return true;
}

// Unfollow a room
async function unfollowRoom(roomId) {
  if (!currentUserId) return false;
  
  if (!followingRooms.has(roomId)) return true;
  
  const { error } = await supabase
    .from('user_follows')
    .delete()
    .eq('user_id', currentUserId)
    .eq('room_id', roomId);
  
  if (error) {
    console.error('Error unfollowing room:', error);
    return false;
  }
  
  followingRooms.delete(roomId);
  return true;
}

// Request notification permission
async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    console.log("This browser does not support notifications");
    return false;
  }
  if (Notification.permission === "granted") return true;
  if (Notification.permission !== "denied") {
    const permission = await Notification.requestPermission();
    return permission === "granted";
  }
  return false;
}

// Send browser notification
function sendNotification(roomId, username, content) {
  if (Notification.permission !== "granted") return;
  
  if (currentUser) {
    const githubName = currentUser.user_metadata?.user_name;
    if (githubName && (username === `[GH]${githubName}` || username === `[GH] ${githubName}`)) {
      return;
    }
  }
  
  const notification = new Notification(`New message in ${roomId}`, {
    body: `${username}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`,
    icon: '/SimplyChat/logo.svg',
    tag: roomId,
  });
  
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
  
  setTimeout(() => notification.close(), 5000);
}

// Follow button DOM element
const followBtn = document.getElementById('follow-btn');

// Update button text and style based on follow status
async function updateFollowButton() {
  console.log('updateFollowButton() called, followBtn exists?', !!followBtn);
  
  if (!followBtn) return;
  
  if (!currentUserId) {
    console.log('No currentUserId, hiding button');
    followBtn.style.display = 'none';
    return;
  }
  
  console.log('Checking if following room:', roomId);
  const following = await isFollowingRoom(roomId);
  console.log('Following status:', following);
  
  followBtn.style.display = 'inline-block';
  
  if (following) {
    followBtn.textContent = '🔕 Unfollow Room';
    followBtn.classList.add('following');
    followBtn.classList.remove('not-following');
  } else {
    followBtn.textContent = '🔔 Follow Room';
    followBtn.classList.add('not-following');
    followBtn.classList.remove('following');
  }
}

// Handle follow button click
if (followBtn) {
  followBtn.addEventListener('click', async () => {
    // If user doesn't exist yet, create them
    if (!currentUserId) {
      await getOrCreateUser();
      await loadFollowedRooms();
    }
    
    const currentlyFollowing = await isFollowingRoom(roomId);
    
    if (!currentlyFollowing) {
      // Request notification permission before following
      const granted = await requestNotificationPermission();
      if (!granted) {
        alert('Please allow notifications in your browser settings to follow rooms.');
        return;
      }
      await followRoom(roomId);
    } else {
      await unfollowRoom(roomId);
    }
    
    await updateFollowButton();
  });
}

// Supabase setup
const supabaseUrl = 'https://koprmimlvjziuznbntzc.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvcHJtaW1sdmp6aXV6bmJudHpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExMDI2NjYsImV4cCI6MjA4NjY3ODY2Nn0.hPp-Fx6o7LtBSW_YIuw7WtJd73z8l1KLbg-O5UbPWeU'
const supabase = createClient(supabaseUrl, supabaseKey)

let roomsIndex = []

// Redirects
const redirect = sessionStorage.getItem('redirect')

if (redirect) {
  sessionStorage.removeItem('redirect')
  window.history.replaceState({}, '', redirect)
}

// Build room list with message counts (for search & ranking)
async function fetchRoomsIndex() {
  const { data, error } = await supabase
    .from('simplychat_messages')
    .select('room_id, created_at')

  if (error) {
    console.error(error)
    return []
  }

  const map = {}

  data.forEach(row => {
    const room = row.room_id.toLowerCase()

    if (!map[room]) {
      map[room] = {
        id: room,
        count: 0,
        lastActivity: 0
      }
    }

    map[room].count++

    const time = new Date(row.created_at).getTime()
    if (time > map[room].lastActivity) {
      map[room].lastActivity = time
    }
  })

  return Object.values(map)
}

// RoomId setup  
//old
/*const parts = window.location.pathname.split('/')

let roomId

if (parts[2] === 'chat' && parts[3]) {
  roomId = parts[3].toLowerCase()
} else {
  roomId = 'global'
}*/
//new
const parts = window.location.pathname.split('/')
let roomId
const redirectPath = sessionStorage.getItem('redirect')

if (redirectPath) {
  const redirectParts = redirectPath.split('/')
  if (redirectParts[2] === 'chat' && redirectParts[3]) {
    roomId = redirectParts[3].toLowerCase()
  } else if (redirectParts[2] && redirectParts[2] !== 'chat' && redirectParts[2] !== '') {
    roomId = redirectParts[2].toLowerCase()
  } else {
    roomId = 'global'
  }
} else if (parts[2] === 'chat' && parts[3]) {
  roomId = parts[3].toLowerCase()
} else if (parts[2] && parts[2] !== 'chat' && parts[2] !== '') {
  roomId = parts[2].toLowerCase()
} else {
  roomId = 'global'
}

console.log('Detected roomId:', roomId)


// Dynamic title (using the RoomId)
/*old, not working on Blog and Explore*/ /*if (roomId === 'global') {
  document.title = 'SimplyChat / Online Chatrooms'
} else {
  document.title = 'SimplyChat / ' + roomId
}*/
if (roomId !== 'global') {
  document.title = 'SimplyChat / ' + roomId
}

// URL cleaning
if (parts[3] && parts[3] !== roomId) {
  window.history.replaceState({}, '', `/SimplyChat/chat/${roomId}`)
}

// DOM elements
const messagesDiv = document.getElementById('messages')
const usernameInput = document.getElementById('username')
const messageInput = document.getElementById('message')
const charCount = document.getElementById('char-count')
const sendBtn = document.getElementById('send')
const githubLoginBtn = document.getElementById('github-login')
const isChatPage =
  messagesDiv &&
  messageInput &&
  charCount &&
  sendBtn
const isExplorePage =
  document.getElementById('explore-results') &&
  document.getElementById('explore-mode')
const fontSlider = document.getElementById('font-slider')
const fontSizeDisplay = document.getElementById('font-size-display')

let currentUser = null

const savedFontSize = localStorage.getItem('fontSize')

if (savedFontSize) {
  document.documentElement.style.setProperty('--font-size', savedFontSize + 'px')

  fontSlider.value = savedFontSize

  fontSizeDisplay.textContent = savedFontSize + 'px'
}

if (fontSlider && fontSizeDisplay) {
  fontSlider.addEventListener('input', () => {
    const size = fontSlider.value

    document.documentElement.style.setProperty('--font-size', size + 'px')

    fontSizeDisplay.textContent = size + 'px'

    localStorage.setItem('fontSize', size)
  })
}

if (isChatPage) {
  // Character counter
  if (messageInput && charCount) {
    messageInput.addEventListener('input', () => { 
      charCount.textContent = `${messageInput.value.length} / 1000`
    })
  }
}

// Add message
function addMessage(msg) {

  /*debug*/console.log('addMessage called:', msg)
  
  if (!messagesDiv) return

  const div = document.createElement('div')
  div.classList.add('message')

  const date = new Date(msg.created_at)

  const day = String(date.getDate()).padStart(2,'0')
  const month = String(date.getMonth() + 1).padStart(2,'0')
  const year = date.getFullYear()

  const hours = String(date.getHours()).padStart(2,'0')
  const minutes = String(date.getMinutes()).padStart(2,'0')

  const tzParts = date.toLocaleTimeString(undefined, { timeZoneName: 'short' }).split(' ')
  const tz = tzParts[tzParts.length - 1] || ''

  let safeText = DOMPurify.sanitize(msg.content)
  safeText = safeText.replace(/\n/g, '<br>')

  div.innerHTML = `
    <div class="msg-header">[${day}/${month}/${year} ${hours}:${minutes} ${tz}] ${formatUsername(msg.username)}:</div>
    <div class="msg-content">${safeText}</div>
  `

  messagesDiv.appendChild(div)
  messagesDiv.scrollTop = messagesDiv.scrollHeight
}

// Load existing messages
async function loadMessages() {

  if (!messagesDiv) return
  
  let query = supabase
    .from('simplychat_messages')
    .select('*')
    .order('created_at', { ascending: true })

  if (roomId === 'global') {
    query = query.eq('room_id', 'global')
  } else {
    query = query.eq('room_id', roomId)
  }

  const { data: messages, error } = await query

  // Temporary debug
  console.log('RoomId being queried:', roomId)
  console.log('Messages returned:', messages)
  console.log('Error:', error)
  // end debug
  
    if (error) {
    console.error('Error loading messages:', error)
  } else {

  // Welcome messages
  const customMessages = {
    'feedback': 'Welcome to the feedback page!',
    'simplychat': 'Find here the latest infos about SimplyChat.',
    'welcome': 'Introduce yourself to SimplyChat!'
  }
  
  const noWelcomeRooms = ['feedback', 'simplychat', 'welcome']
  
  function addSystemMessage(text, insertAtTop) {
    const div = document.createElement('div')
    div.classList.add('message')
    div.style.fontStyle = 'italic'
    div.style.color = '#8c8c8c'
    div.textContent = text
    
    if (insertAtTop) {
      messagesDiv.insertBefore(div, messagesDiv.firstChild)
    } else {
      messagesDiv.appendChild(div)
    }
  }
  
  // Welcome message goes to top (always)
  if (!noWelcomeRooms.includes(roomId)) {
    addSystemMessage(`Welcome to /${roomId}!`, true)
  }
  
  // Custom message goes after welcome but before chat messages
  if (customMessages[roomId]) {
    addSystemMessage(customMessages[roomId], false)
  }
  
  // Add messages from Supabase
  if (messages && messages.length > 0) {
    messages.forEach(addMessage)
  }
  
  // Server message only if no messages, goes after custom message
  if (!messages || messages.length === 0) {
    addSystemMessage('Server : No messages yet.', false)
  }
  // End Welcome messages
  }
}

if (messagesDiv) {
  loadMessages()
}

async function initRooms() {
  roomsIndex = await fetchRoomsIndex()
}

if (isExplorePage) {

  loadExplore()

  document.getElementById('explore-mode')
    .addEventListener('change', function () {
      loadExplore()
    })

}

async function loadExplore() {

  const rooms = await fetchRoomsIndex()

  const mode = document.getElementById('explore-mode').value

  renderExplore(rooms, mode)
}

function renderExplore(rooms, mode) {

  const container = document.getElementById('explore-results')

  container.innerHTML = ""

  let sorted = [...rooms]

  if (mode === "trending") {

    sorted.sort(function (a, b) {
      return b.lastActivity - a.lastActivity
    })

  } else if (mode === "popular") {

    sorted.sort(function (a, b) {
      return b.count - a.count
    })

  } else if (mode === "alphabetic") {

    sorted.sort(function (a, b) {
      return a.id.localeCompare(b.id)
    })

  }

  sorted.forEach(function (room) {

    const div = document.createElement("div")
    div.classList.add("explore-room")

    div.textContent =
      room.id + " (" + room.count + " messages)"

    div.onclick = function () {
      window.location.href =
        "/SimplyChat/chat/" + room.id
    }

    container.appendChild(div)

  })
}

initRooms()

const chatChannel = supabase
  .channel('room:' + roomId)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'simplychat_messages',
    filter: `room_id=eq.${roomId.toLowerCase()}`
  }, payload => {
    addMessage(payload.new)
  })
  .subscribe()

if (isChatPage) {
  sendBtn.addEventListener('click', async () => {
    let username = 'Anonymous'

    if (currentUser) { 
      username = `[GH]${currentUser.user_metadata.user_name}` 
    } else {
      username = usernameInput.value.trim() || 'Anonymous'
    }
  
    const content = messageInput.value.trim()
    if (!content) return
    if (content.length > 1000) {
      alert('Your message exceeds 1000 characters')
      return
    }

    const { error } = await supabase.from('simplychat_messages').insert([{
      username,
      content,
      room_id: roomId.toLowerCase()
    }])

    if (error) {
      console.error('Error inserting message:', error)
    } else {
      messageInput.value = ''
      charCount.textContent = '0 / 1000'
    }
  })
}

if (githubLoginBtn) {
  githubLoginBtn.addEventListener('click', async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: 'https://sclf-xingshu.github.io/SimplyChat/' }
    })
  })
}

async function checkUser() {
  console.log('checkUser() started');
  
  const { data: { session }, error } = await supabase.auth.getSession()

  if (error) {
    console.error('Error getting session from URL:', error)
  }

  currentUser = session?.user || null
  console.log('currentUser:', currentUser);

  // Initialize user IDs and followed rooms
  console.log('Calling getOrCreateUser()...');
  await getOrCreateUser();
  console.log('getOrCreateUser() completed, currentUserId:', currentUserId);
  
  console.log('Calling loadFollowedRooms()...');
  await loadFollowedRooms();
  console.log('loadFollowedRooms() completed, followingRooms size:', followingRooms.size);
  
  console.log('Calling updateFollowButton()...');
  updateFollowButton();
  console.log('updateFollowButton() completed');

  if (currentUser) {
    const githubUsername = currentUser.user_metadata.user_name
    if (usernameInput) {
      usernameInput.value = `[GH] ${githubUsername}`
      usernameInput.disabled = true
    }
  }

  if (window.location.hash) {
    history.replaceState(null, '', window.location.pathname)
  }
}

checkUser()

supabase.auth.onAuthStateChange(async (_event, session) => {
  if (session) {
    currentUser = session.user
    const githubUsername = currentUser.user_metadata.user_name
    if (usernameInput) {
      usernameInput.value = `[GH] ${githubUsername}`
      usernameInput.disabled = true
    }
    
    // Initialize user IDs and followed rooms on login
    await getOrCreateUser();
    await loadFollowedRooms();
    updateFollowButton();
  }
})


  /*function render(results, query, mode) {

    roomResults.innerHTML = ''
    if (!query) return

    let finalResults = [...results]

    const exists = finalResults.some(r => r.id === query)

    if (!exists) {
      finalResults.unshift({
        id: query,
        count: 0,
        lastActivity: 0,
        virtual: true
      })
    }

    if (mode === 'match') {
      finalResults.sort((a, b) =>
        scoreMatch(b.id, query) - scoreMatch(a.id, query)
      )
    }

    if (mode === 'popular') {
      finalResults.sort((a, b) => b.count - a.count)
    }

    if (mode === 'trending') {
      finalResults.sort((a, b) => b.lastActivity - a.lastActivity)
    }

    finalResults.forEach(room => {

      const div = document.createElement('div')

      div.textContent = room.virtual
        ? `${room.id} (new room)`
        : `${room.id} (${room.count})`

      div.onclick = () => {
        window.location.href = `/SimplyChat/chat/${room.id}`
      }

      roomResults.appendChild(div)
    })
  }*/

  /*roomSearch.addEventListener('input', () => {

    const query = roomSearch.value.toLowerCase().trim()
    const mode = roomMode.value

    const filtered = roomsIndex.filter(room =>
      room.id.includes(query)
    )

    render(filtered, query, mode)
  })*/

function initRoomSearchSystem() {

  const roomSearch = document.getElementById('room-search')
  const roomResults = document.getElementById('room-results')
  const roomMode = document.getElementById('room-mode')

  if (!roomSearch || !roomResults || !roomMode) return

  function scoreMatch(text, query) {
    let score = 0
    if (text === query) score += 100
    if (text.includes(query)) score += 20

    for (let i = 0; i < Math.min(text.length, query.length); i++) {
      if (text[i] === query[i]) score++
    }

    return score
  }

  function render(results, query, mode) {

    roomResults.innerHTML = ''
    if (!query) return

    let finalResults = [...results]

    const exists = finalResults.some(r => r.id === query)

    if (!exists) {
      finalResults.unshift({
        id: query,
        count: 0,
        lastActivity: 0,
        virtual: true
      })
    }

    if (mode === 'match') {
      finalResults.sort((a, b) =>
        scoreMatch(b.id, query) - scoreMatch(a.id, query)
      )
    }

    if (mode === 'popular') {
      finalResults.sort((a, b) => b.count - a.count)
    }

    if (mode === 'trending') {
      finalResults.sort((a, b) => b.lastActivity - a.lastActivity)
    }

    finalResults.forEach(room => {

      const div = document.createElement('div')

      div.textContent = room.virtual
        ? `${room.id} (new room)`
        : `${room.id} (${room.count})`

      div.onclick = () => {
        window.location.href = `/SimplyChat/chat/${room.id}`
      }

      roomResults.appendChild(div)
    })
  }

  roomSearch.addEventListener('input', () => {

    const query = roomSearch.value.toLowerCase().trim()
    const mode = roomMode.value

    const filtered = roomsIndex.filter(room =>
      room.id.includes(query)
    )

    render(filtered, query, mode)
  })
}

initRoomSearchSystem()
