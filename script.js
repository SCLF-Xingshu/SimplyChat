import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

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
    .select('room_id')

  if (error) {
    console.error('Room fetch error:', error)
    return []
  }

  const map = {}

  data.forEach(row => {
    const room = row.room_id.toLowerCase()

    // count messages per room
    map[room] = (map[room] || 0) + 1
  })

  // convert object → array
  return Object.entries(map).map(([id, count]) => ({
    id,
    count
  }))
}

// RoomId setup  
const parts = window.location.pathname.split('/')

let roomId

if (parts[2] === 'chat' && parts[3]) {
  roomId = parts[3].toLowerCase()
} else {
  roomId = 'global'
}

// Dynamic title (using the RoomId)
if (roomId === 'global') {
  document.title = 'SimplyChat / Online Chatrooms'
} else {
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
const fontSlider = document.getElementById('font-slider')
const fontSizeDisplay = document.getElementById('font-size-display')

let currentUser = null

const savedFontSize = localStorage.getItem('fontSize')

if (savedFontSize) {
  document.documentElement.style.setProperty('--font-size', savedFontSize + 'px')

  fontSlider.value = savedFontSize

  fontSizeDisplay.textContent = savedFontSize + 'px'
}

fontSlider.addEventListener('input', () => {
  const size = fontSlider.value

  document.documentElement.style.setProperty('--font-size', size + 'px')

  fontSizeDisplay.textContent = size + 'px'

  localStorage.setItem('fontSize', size)
})

// Character counter
messageInput.addEventListener('input', () => { 
  charCount.textContent = `${messageInput.value.length} / 1000`
})

// Add message
function addMessage(msg) {
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
    <div class="msg-header">[${day}/${month}/${year} ${hours}:${minutes} ${tz}] ${msg.username}:</div>
    <div class="msg-content">${safeText}</div>
  `
  
  messagesDiv.appendChild(div)
  messagesDiv.scrollTop = messagesDiv.scrollHeight
}

// Load existing messages
async function loadMessages() {

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
  
  if (error) {
    console.error('Error loading messages:', error)
  } else {

    if (!messages || messages.length === 0) {
      const empty = document.createElement('div')
      empty.classList.add('message')
      empty.textContent = 'Server : No messages yet.'
      empty.style.fontStyle = 'italic'
      empty.style.color = '#8c8c8c'
      messagesDiv.appendChild(empty)
    } else {
      messages.forEach(addMessage)
    }

  }
}

loadMessages()

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

async function initRooms() {
  roomsIndex = await fetchRoomsIndex()
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

sendBtn.addEventListener('click', async () => {
  let username = 'Anonymous'

  if (currentUser) { 
    username = `[GH] ${currentUser.user_metadata.user_name}` 
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

githubLoginBtn.addEventListener('click', async () => {
  await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: 'https://sclf-xingshu.github.io/SimplyChat/' }
  })
})

async function checkUser() {
  const { data: { session }, error } = await supabase.auth.getSession()

  if (error) {
    console.error('Error getting session from URL:', error)
  }

  currentUser = session?.user || null

  if (currentUser) {
    const githubUsername = currentUser.user_metadata.user_name
    usernameInput.value = `[GH] ${githubUsername}`
    usernameInput.disabled = true
  }

  if (window.location.hash) {
    history.replaceState(null, '', window.location.pathname)
  }
}

checkUser()

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) {
    currentUser = session.user
    const githubUsername = currentUser.user_metadata.user_name
    usernameInput.value = `[GH] ${githubUsername}`
    usernameInput.disabled = true
  }
})

window.addEventListener('DOMContentLoaded', () => {

  const roomSearch = document.getElementById('room-search')
  const roomResults = document.getElementById('room-results')
  const roomMode = document.getElementById('room-mode')

  if (!roomSearch || !roomResults || !roomMode) {
    console.error("Room search elements not found in DOM")
    return
  }

  function scoreMatch(text, query) {
    let score = 0

    if (text === query) score += 100
    if (text.includes(query)) score += 20

    for (let i = 0; i < Math.min(text.length, query.length); i++) {
      if (text[i] === query[i]) score++
    }

    return score
  }

  roomSearch.addEventListener('input', () => {
    const query = roomSearch.value.toLowerCase().trim()
    const mode = roomMode.value

    roomResults.innerHTML = ''
    if (!query) return

    if (!roomsIndex || roomsIndex.length === 0) return

    let results = roomsIndex.filter(r =>
      r.id.includes(query)
    )

    if (mode === 'match') {
      results.sort((a, b) =>
        scoreMatch(b.id, query) - scoreMatch(a.id, query)
      )
    }

    if (mode === 'popular') {
      results.sort((a, b) => b.count - a.count)
    }

    if (mode === 'trending') {
      results.sort((a, b) => b.lastActivity - a.lastActivity)
    }

    results.forEach(room => {
      const div = document.createElement('div')
      div.textContent = `${room.id} (${room.count})`

      div.onclick = () => {
        window.location.href = `/SimplyChat/chat/${room.id}`
      }

      roomResults.appendChild(div)
    })
  })

})
