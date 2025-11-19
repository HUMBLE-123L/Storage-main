// File: js/presence.js
// Local "Presence" (you-only) — indicates viewing/editing state for better UX
// Does NOT use Firestore or any database.

export function initPresence(options = {}) {
  const { parentSelector = 'body', fileName = null } = options;
  const parent = document.querySelector(parentSelector);

  if (!parent) {
    console.warn('[Presence] Parent container not found:', parentSelector);
    return;
  }

  // Create the presence container if it doesn't exist
  let container = document.getElementById('presence-indicator');
  if (!container) {
    container = document.createElement('div');
    container.id = 'presence-indicator';
    container.className = 'presence-indicator viewing';
    container.innerHTML = `
      <span class="presence-dot"></span>
      <span class="presence-text">Viewing${fileName ? `: ${fileName}` : ''}</span>
    `;
    parent.appendChild(container);
  }

  const dot = container.querySelector('.presence-dot');
  const text = container.querySelector('.presence-text');

  // Switch between "Viewing" and "Editing" modes
  function setEditing(isEditing) {
    if (isEditing) {
      container.classList.add('editing');
      dot.classList.add('editing');
      text.textContent = `Editing${fileName ? `: ${fileName}` : ''}`;
    } else {
      container.classList.remove('editing');
      dot.classList.remove('editing');
      text.textContent = `Viewing${fileName ? `: ${fileName}` : ''}`;
    }
  }

  // Automatically detect user typing
  let typingTimeout = null;
  document.addEventListener('input', (e) => {
    if (!e.isTrusted) return;
    setEditing(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => setEditing(false), 2000);
  });

  // On page unload, reset state
  window.addEventListener('beforeunload', () => setEditing(false));

  return { setEditing };
}