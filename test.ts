// ─── Note Frequency Table: C3 through B5, natural notes ──────────
// Rounded to nearest integer Hz (matches Python version's tuning)
const NOTE_LETTERS = [
    "C", "D", "E", "F", "G", "A", "B",   // octave 3
    "C", "D", "E", "F", "G", "A", "B",   // octave 4
    "C", "D", "E", "F", "G", "A", "B"    // octave 5
]
const NOTE_FREQS = [
    131, 147, 165, 175, 196, 220, 247,    // octave 3
    262, 294, 330, 349, 392, 440, 494,    // octave 4
    523, 587, 659, 698, 784, 880, 988     // octave 5
]

// ─── Tuneable Constants ──────────────────────────────────────────
const TRIGGER_PEAK = 15    // ADC peak-to-peak threshold to trigger detection
const BAR_SCALE = 6        // peak-to-peak units per VU bar segment
const SUSTAIN_COUNT = 3    // consecutive loud frames before running FFT
const QUIET_RESET = 2      // consecutive quiet frames to reset counter
const FREQ_TOLERANCE = 20  // max Hz distance from a note to count as a match

// ─── State ───────────────────────────────────────────────────────
let loudCount = 0
let quietCount = 0

/**
 * Map a detected frequency to the nearest note letter.
 * Returns "" if the frequency is out of range or too far from any note.
 */
function freqToNote(freq: number): string {
    if (freq < 120 || freq > 1050) return ""
    let bestIdx = 0
    let bestDist = 99999
    for (let i = 0; i < NOTE_FREQS.length; i++) {
        let dist = Math.abs(freq - NOTE_FREQS[i])
        if (dist < bestDist) {
            bestDist = dist
            bestIdx = i
        }
    }
    if (bestDist > FREQ_TOLERANCE) return ""
    return NOTE_LETTERS[bestIdx]
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

    // VU meter on bottom row of LED matrix
    let bars = Math.min(5, Math.idiv(peakToPeak, BAR_SCALE))
    for (let x = 0; x < 5; x++) {
        led.plotBrightness(x, 4, x < bars ? 255 : 0)
    }

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
        let sFreq = audioFFT.secondaryFrequency()
        let pNote = freqToNote(pFreq)
        let sNote = freqToNote(sFreq)

        if (pNote.length > 0) {
            if (sNote.length > 0 && sNote !== pNote) {
                basic.showString(pNote + "+" + sNote, 80)
            } else {
                basic.showString(pNote)
            }
            pins.digitalWritePin(DigitalPin.P0, 1)
            basic.pause(3000)
            pins.digitalWritePin(DigitalPin.P0, 0)
            basic.showString(" ")
        } else {
            basic.showString("-")
            basic.pause(500)
            basic.showString(" ")
        }
    }

    basic.pause(10)
})
