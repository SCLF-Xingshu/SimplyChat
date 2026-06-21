// 1 - get DOM elements
const input = document.getElementById('roomName');
const btn = document.getElementById('createBtn');
const error = document.getElementById('errorMsg');
// end 1

// 2 - validate room name and create room
function validateAndCreate() {
  const name = input.value.trim();
  // end 2

  // 2.1 - reset error
  error.classList.remove('visible');
  // end 2.1

  // 2.2 - check if name is empty
  if (!name) {
    error.textContent = 'Room name is required.';
    error.classList.add('visible');
    return;
  }
  // end 2.2

  // 2.3 - check max length
  if (name.length > 32) {
    error.textContent = 'Max 32 characters.';
    error.classList.add('visible');
    return;
  }
  // end 2.3

  // 2.4 - check allowed characters
  if (!/^[a-z0-9\-_]+$/.test(name)) {
    error.textContent = 'Only lowercase letters, numbers, hyphens, and underscores are allowed.';
    error.classList.add('visible');
    return;
  }
  // end 2.4

  // 2.5 - redirect to the new room
  window.location.href = `/SimplyChat/chat/${name}`;
  // end 2.5
}
// end 2

// 3 - event listeners
btn.addEventListener('click', validateAndCreate);
// end 3

// 4 - clear error on input
input.addEventListener('input', () => error.classList.remove('visible'));
// end 4

// 5 - enter key support
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    validateAndCreate();
  }
});
// end 5
