// ─── Note Frequency Table: natural notes C2 through B7 ─────────────
// 7 natural notes per octave (no sharps/flats), 6 octaves = 42 entries
const NOTE_LETTERS = [
    "C", "D", "E", "F", "G", "A", "B",  // octave 2
    "C", "D", "E", "F", "G", "A", "B",  // octave 3
    "C", "D", "E", "F", "G", "A", "B",  // octave 4
    "C", "D", "E", "F", "G", "A", "B",  // octave 5
    "C", "D", "E", "F", "G", "A", "B",  // octave 6
    "C", "D", "E", "F", "G", "A", "B"   // octave 7
]
const NOTE_FREQS = [
    65,  73,  82,  87,  98,  110, 123,   // octave 2
    131, 147, 165, 175, 196, 220, 247,   // octave 3
    262, 294, 330, 349, 392, 440, 494,   // octave 4
    523, 587, 659, 698, 784, 880, 988,   // octave 5
    1047, 1175, 1319, 1397, 1568, 1760, 1976,  // octave 6
    2093, 2349, 2637, 2794, 3136, 3520, 3951   // octave 7
]

// ─── Tuneable Constants ──────────────────────────────────────────
const TRIGGER_LEVEL = 30   // sound level threshold (0-255 from built-in mic)
const SUSTAIN_COUNT = 3    // consecutive loud frames before running FFT
const QUIET_RESET = 2      // consecutive quiet frames to reset counter
const FREQ_TOLERANCE_PCT = 10  // max % distance from a note to count as a match
const QUIET_CLEAR_MS = 1500 // ms of silence before clearing the display

// ─── State ───────────────────────────────────────────────────────
let loudCount = 0
let quietCount = 0
let lastNoteTime = 0

// Result of note lookup
let matchedNote = ""
let matchedFreq = 0

// Current display state
let displayedNote = ""
let displayedFreq = 0
let secondaryNote = ""
let secondaryFreqHz = 0
let showSecondary = false

// ─── Sequence Detection ───────────────────────────────────────────
const TARGET_SEQUENCE = ["C", "C", "E", "G"]
const MAX_SEQUENCE = 6  // max notes before auto-reset
let noteSlots: string[] = ["", "", "", "", "", ""]  // fixed-size, no heap alloc
let noteCount = 0
let lastSequenceNote = ""
let hadSilence = false

function playSuccess(): void {
    music.playTone(523, 100)   // C5
    music.playTone(659, 100)   // E5
    music.playTone(784, 100)   // G5
    music.playTone(1047, 300)  // C6
}

function resetSequence(): void {
    for (let i = 0; i < MAX_SEQUENCE; i++) {
        noteSlots[i] = ""
    }
    noteCount = 0
    lastSequenceNote = ""
}

function checkSequence(): void {
    if (noteCount < TARGET_SEQUENCE.length) return
    let start = noteCount - TARGET_SEQUENCE.length
    for (let i = 0; i < TARGET_SEQUENCE.length; i++) {
        if (noteSlots[start + i] !== TARGET_SEQUENCE[i]) return
    }
    playSuccess()
    resetSequence()
    // Cooldown: pause before listening again so buffers settle
    basic.pause(1000)
    loudCount = 0
    quietCount = 0
}

// ─── Startup: let ADC/mic settle before listening ────────────────
basic.pause(2000)

/**
 * Map a detected frequency to the nearest note letter.
 * Sets matchedNote and matchedFreq. matchedNote is "" if no match.
 */
function freqToNote(freq: number): void {
    matchedNote = ""
    matchedFreq = 0
    if (freq < 60 || freq > 4000) return
    let bestIdx = 0
    let bestDist = 99999
    for (let i = 0; i < NOTE_FREQS.length; i++) {
        let dist = Math.abs(freq - NOTE_FREQS[i])
        if (dist < bestDist) {
            bestDist = dist
            bestIdx = i
        }
    }
    if (bestDist * 100 > NOTE_FREQS[bestIdx] * FREQ_TOLERANCE_PCT) return
    matchedNote = NOTE_LETTERS[bestIdx]
    matchedFreq = NOTE_FREQS[bestIdx]
}

// ─── 4x5 font for note letters (cols 0-3, full height) ───────────
// Each entry is a 5-element array of 4-bit row bitmasks (bit 3 = col 0).
function notePattern(letter: string): number[] {
    //                         row0    row1    row2    row3    row4
    if (letter === "A") return [0b0110, 0b1001, 0b1111, 0b1001, 0b1001]
    if (letter === "B") return [0b1110, 0b1001, 0b1110, 0b1001, 0b1110]
    if (letter === "C") return [0b0111, 0b1000, 0b1000, 0b1000, 0b0111]
    if (letter === "D") return [0b1110, 0b1001, 0b1001, 0b1001, 0b1110]
    if (letter === "E") return [0b1111, 0b1000, 0b1110, 0b1000, 0b1111]
    if (letter === "F") return [0b1111, 0b1000, 0b1110, 0b1000, 0b1000]
    if (letter === "G") return [0b0111, 0b1000, 0b1011, 0b1001, 0b0111]
    return                     [0b0000, 0b0000, 0b0000, 0b0000, 0b0000]
}

/**
 * Show a note letter on the LED matrix using all 5 rows, columns 0-3.
 */
function showNote(note: string): void {
    // Clear cols 0-3 across all rows
    for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 4; x++) {
            led.unplot(x, y)
        }
    }
    if (note.length === 0) return
    let letter = note.charAt(0)
    let rows = notePattern(letter)
    for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 4; x++) {
            if (rows[y] & (1 << (3 - x))) {
                led.plot(x, y)
            }
        }
    }
}

// ─── Button handlers: toggle primary/secondary display ──────────
input.onButtonPressed(Button.A, function () {
    showSecondary = false
    if (displayedNote.length > 0) {
        showNote(displayedNote)
    }
})

input.onButtonPressed(Button.B, function () {
    showSecondary = true
    if (secondaryNote.length > 0) {
        showNote(secondaryNote)
    }
})

// Show info on A+B: scroll the detected frequency in Hz
input.onButtonPressed(Button.AB, function () {
    let freq = showSecondary ? secondaryFreqHz : displayedFreq
    if (freq > 0) {
        basic.showNumber(freq)
        // Re-show the current note after scrolling
        let note = showSecondary ? secondaryNote : displayedNote
        if (note.length > 0) {
            showNote(note)
        }
    }
})

// ─── Main Loop ───────────────────────────────────────────────────
basic.forever(function () {
    // Quick sound level check using built-in microphone (0-255)
    let level = input.soundLevel()

    // Hysteresis trigger
    if (level > TRIGGER_LEVEL) {
        loudCount += 1
        quietCount = 0
    } else {
        quietCount += 1
        if (quietCount >= QUIET_RESET) {
            loudCount = 0
        }
    }

    // Sustained loud signal → run full FFT analysis
    if (loudCount >= SUSTAIN_COUNT) {
        loudCount = 0
        quietCount = 0

        audioFFT.runAnalysis()

        // Primary note
        let pFreq = audioFFT.primaryFrequency()
        freqToNote(pFreq)

        if (matchedNote.length > 0) {
            displayedNote = matchedNote
            displayedFreq = pFreq
            lastNoteTime = input.runningTime()

            // Sequence tracking: add if note changed or there was a silence gap
            if (hadSilence || matchedNote !== lastSequenceNote) {
                if (noteCount >= MAX_SEQUENCE) {
                    resetSequence()
                }
                noteSlots[noteCount] = matchedNote
                noteCount += 1
                lastSequenceNote = matchedNote
                hadSilence = false
                checkSequence()
            }

            // Secondary note
            let sFreq = audioFFT.secondaryFrequency()
            if (sFreq > 0) {
                freqToNote(sFreq)
                secondaryNote = matchedNote
                secondaryFreqHz = sFreq
            } else {
                secondaryNote = ""
                secondaryFreqHz = 0
            }

            // Display whichever note the user has selected
            if (showSecondary && secondaryNote.length > 0) {
                showNote(secondaryNote)
            } else {
                showNote(displayedNote)
            }
        }
    }

    // Clear display after sustained silence
    if (displayedNote.length > 0 && input.runningTime() - lastNoteTime > QUIET_CLEAR_MS) {
        displayedNote = ""
        displayedFreq = 0
        secondaryNote = ""
        secondaryFreqHz = 0
        hadSilence = true
        // Clear letter area
        for (let y = 0; y < 5; y++) {
            for (let x2 = 0; x2 < 4; x2++) {
                led.unplot(x2, y)
            }
        }
    }

    basic.pause(20)
})
