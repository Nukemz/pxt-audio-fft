// ─── Note Frequency Table: C4 through B6, full chromatic scale ─────
// All 12 semitones per octave for accurate matching with sharps/flats
const NOTE_LETTERS = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",  // octave 4
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",  // octave 5
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"   // octave 6
]
const NOTE_FREQS = [
    262, 277, 294, 311, 330, 349, 370, 392, 415, 440, 466, 494,         // octave 4
    523, 554, 587, 622, 659, 698, 740, 784, 831, 880, 932, 988,         // octave 5
    1047, 1109, 1175, 1245, 1319, 1397, 1480, 1568, 1661, 1760, 1865, 1976 // octave 6
]

// ─── Tuneable Constants ──────────────────────────────────────────
const TRIGGER_LEVEL = 30   // sound level threshold (0-255 from built-in mic)
const SUSTAIN_COUNT = 3    // consecutive loud frames before running FFT
const QUIET_RESET = 2      // consecutive quiet frames to reset counter
const FREQ_TOLERANCE = 15  // max Hz distance from a note to count as a match
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

// ─── Startup: let ADC/mic settle before listening ────────────────
basic.pause(1000)

/**
 * Map a detected frequency to the nearest note letter.
 * Sets matchedNote and matchedFreq. matchedNote is "" if no match.
 */
function freqToNote(freq: number): void {
    matchedNote = ""
    matchedFreq = 0
    if (freq < 200 || freq > 2050) return
    let bestIdx = 0
    let bestDist = 99999
    for (let i = 0; i < NOTE_FREQS.length; i++) {
        let dist = Math.abs(freq - NOTE_FREQS[i])
        if (dist < bestDist) {
            bestDist = dist
            bestIdx = i
        }
    }
    if (bestDist > FREQ_TOLERANCE) return
    matchedNote = NOTE_LETTERS[bestIdx]
    matchedFreq = NOTE_FREQS[bestIdx]
}

// ─── 5x4 font for note letters (rows 0-3, row 4 reserved for VU) ─
// Each entry is a 4-element array of 5-bit row bitmasks (MSB = col 0)
function notePattern(letter: string): number[] {
    //                         row0   row1   row2   row3
    if (letter === "A") return [0b01110, 0b10001, 0b11111, 0b10001]
    if (letter === "B") return [0b11110, 0b10011, 0b11110, 0b11111]
    if (letter === "C") return [0b01111, 0b10000, 0b10000, 0b01111]
    if (letter === "D") return [0b11110, 0b10001, 0b10001, 0b11110]
    if (letter === "E") return [0b11111, 0b11100, 0b11000, 0b11111]
    if (letter === "F") return [0b11111, 0b11100, 0b10000, 0b10000]
    if (letter === "G") return [0b01111, 0b10000, 0b10011, 0b01111]
    return                     [0b00000, 0b00000, 0b00000, 0b00000]
}

/**
 * Show a note letter on the LED matrix (rows 0-3).
 * Row 4 is reserved for the VU meter.
 */
function showNote(note: string): void {
    // Clear rows 0-3 only (preserve VU meter on row 4)
    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 5; x++) {
            led.unplot(x, y)
        }
    }
    if (note.length === 0) return
    let letter = note.charAt(0)
    let rows = notePattern(letter)
    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 5; x++) {
            if (rows[y] & (1 << (4 - x))) {
                led.plot(x, y)
            }
        }
    }
    // If sharp, light the top-right corner as an indicator
    if (note.length > 1) {
        led.plot(4, 0)
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

    // VU meter on bottom row — shows mic activity (scale 0-255 into 5 bars)
    let bars = Math.min(5, Math.idiv(level, 50))
    for (let x = 0; x < 5; x++) {
        led.plotBrightness(x, 4, x < bars ? 255 : 0)
    }

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
        // Clear rows 0-3 (preserve VU meter)
        for (let y = 0; y < 4; y++) {
            for (let x2 = 0; x2 < 5; x2++) {
                led.unplot(x2, y)
            }
        }
    }

    basic.pause(10)
})
