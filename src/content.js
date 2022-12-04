// State ───────────────────────────────────────────────────────────────────────

const state = {}
state.lastUsedInput = null

window.addEventListener('focus', (event) => {
  if (isText(event.target)) {
    state.lastUsedInput = event.target
  }
}, true)

// Requests ────────────────────────────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener(async (request) => {
    const command = requests[request.command]
    const arguments = request.arguments || []
    const self = {
      port
    }
    if (command) {
      await command.apply(self, arguments)
    }
  })
})

const requests = {}

requests['edit-text-input'] = function() {
  if (!state.lastUsedInput || document.hidden) {
    return
  }
  const [[anchorLine, anchorColumn], [cursorLine, cursorColumn]] = getSelectionRange(state.lastUsedInput)
  const text = getInputValue(state.lastUsedInput)
  this.port.postMessage({
    command: 'edit',
    arguments: [{ text, anchorLine, anchorColumn, cursorLine, cursorColumn }]
  })
}

requests['fill-text-input'] = async (text) => {
  if (document.hidden) {
    return
  }
  if (!state.lastUsedInput) {
    await navigator.clipboard.writeText(text)
    return
  }
  const input = state.lastUsedInput
  if (input.isContentEditable) {
    await updateContentEditableText(input, text)
  }
  input.value = text
  input.focus()
}

// Helpers ─────────────────────────────────────────────────────────────────────

// Many different issues w/ WYSIWYG editors.
const updateContentEditableText = async (input, text) => {
  // contentEditable is sketch, so copy...
  await navigator.clipboard.writeText(text)
  try {
    window.eval(`
    const pasteEvent = new ClipboardEvent("paste", { bubbles: true, composed: true })
    pasteEvent.clipboardData = new DataTransfer()
    pasteEvent.clipboardData.setData("text/plain", ${JSON.stringify(text)})
    const input = document.querySelector('.${Array.from(input.classList).join(".")}')
    input.focus()
    document.execCommand("selectAll")
    setTimeout(() => input.dispatchEvent(pasteEvent), 50)
    `)
  } catch {
    // Some editors, like on Slack, use this.
    input.textContent = text
  }
}

const isText = (element) => {
  const nodeNames = ['INPUT', 'TEXTAREA', 'OBJECT']
  return element.offsetParent !== null && (nodeNames.includes(element.nodeName) || element.isContentEditable)
}

const getInputValue = (input) => {
  if (input.isContentEditable) {
    document.execCommand("selectAll")
    return document.getSelection().toString()
  }
  return input.value ?? input.textContent ?? ""
}

const getSelectionRange = (input) => {
  let anchorPosition, cursorPosition
  switch (input.selectionDirection) {
    case 'forward':
      [anchorPosition, cursorPosition] = [input.selectionStart, input.selectionEnd]
      break
    case 'backward':
      [cursorPosition, anchorPosition] = [input.selectionStart, input.selectionEnd]
      break
    default:
      [anchorPosition, cursorPosition] = getSelectionInContentEditable()
  }
  const [anchorLine, anchorColumn] = getSelectionPosition(input, anchorPosition)
  const [cursorLine, cursorColumn] = getSelectionPosition(input, cursorPosition)
  return [[anchorLine, anchorColumn], [cursorLine, cursorColumn]]
}

function getSelectionInContentEditable() {
  const sel = window.getSelection()
  if (!sel) {
    return [0, 0]
  }
  return [sel.anchorOffset, sel.focusOffset]
}

const getSelectionPosition = (input, position) => {
  const value = getInputValue(input)
  const textLines = value.slice(0, position).split('\n')
  const line = textLines.length
  const column = textLines[textLines.length - 1].length + 1
  return [line, column]
}
