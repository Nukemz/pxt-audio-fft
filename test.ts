// ─── Note Frequency Table: C4 through B6, natural notes ──────────
// Rounded to nearest integer Hz
const NOTE_LETTERS = [
    "C", "D", "E", "F", "G", "A", "B",   // octave 4
    "C", "D", "E", "F", "G", "A", "B",   // octave 5
    "C", "D", "E", "F", "G", "A", "B"    // octave 6
]
const NOTE_FREQS = [
    262, 294, 330, 349, 392, 440, 494,    // octave 4
    523, 587, 659, 698, 784, 880, 988,    // octave 5
    1047, 1175, 1319, 1397, 1568, 1760, 1976 // octave 6
]

// ─── Tuneable Constants ──────────────────────────────────────────
const TRIGGER_PEAK = 15    // ADC peak-to-peak threshold to trigger detection
const SUSTAIN_COUNT = 3    // consecutive loud frames before running FFT
const QUIET_RESET = 2      // consecutive quiet frames to reset counter
const FREQ_TOLERANCE = 20  // max Hz distance from a note to count as a match
const TONE_DURATION = 500  // ms to play the detected note on the speaker

// ─── State ───────────────────────────────────────────────────────
let loudCount = 0
let quietCount = 0

// Result of note lookup
let matchedNote = ""
let matchedFreq = 0

/**
 * Map a detected frequency to the nearest note letter.
 * Sets matchedNote and matchedFreq. matchedNote is "" if no match.
 */
function freqToNote(freq: number): void {
    matchedNote = ""
    matchedFreq = 0
    if (freq < 200 || freq > 2000) return
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

// ─── Main Loop ───────────────────────────────────────────────────
basic.forever(function () {
    // Quick 50-sample peak-to-peak check on pin1
    let lo = 1023
    let hi = 0
    for (let i = 0; i < 50; i++) {
        let v = pins.analogReadPin(AnalogPin.P1)
        if (v < lo) lo = v
        if (v > hi) hi = v
    }
    let peakToPeak = hi - lo

    // Hysteresis trigger
    if (peakToPeak > TRIGGER_PEAK) {
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

        let pFreq = audioFFT.primaryFrequency()
        freqToNote(pFreq)

        if (matchedNote.length > 0) {
            basic.showString(matchedNote)
            music.playTone(matchedFreq, TONE_DURATION)
        }
    }

    basic.pause(10)
})
